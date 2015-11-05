'use strict';

/**
 * Module dependencies
 */

// Node.js core.
const crypto = require('crypto');

// Public node modules.
const _ = require('lodash');
const anchor = require('anchor');

/**
 * Auth controller
 */

module.exports = {

  /**
   * Main action for login
   * both for local auth an provider auth.
   */

  callback: function * () {
    const ctx = this;

    const provider = ctx.params.provider || 'local';
    const params = ctx.request.body;
    const access_token = ctx.query.access_token;

    if (provider === 'local') {
      // The identifier is required.
      if (!params.identifier) {
        ctx.status = 400;
        return ctx.body = {message: 'Please provide your username or your e-mail.'};
      }

      // The password is required.
      if (!params.password) {
        ctx.status = 400;
        return ctx.body = {message: 'Please provide your password.'};
      }

      const query = {};
      query.provider = 'local';

      // Check if the provided identifier is an email or not.
      const isEmail = !anchor(params.identifier).to({
        type: 'email'
      });

      // Set the identifier to the appropriate query field.
      if (isEmail) {
        query.email = params.identifier;
      } else {
        query.username = params.identifier;
      }

      // Check if the user exists.
      try {
        const user = yield User.findOne(query);

        if (!user) {
          ctx.status = 403;
          return ctx.body = {message: 'Identifier or password invalid.'};
        }

        const validPassword = user.validatePassword(params.password);

        if (!validPassword) {
          ctx.status = 403;
          return ctx.body = {message: 'Identifier or password invalid.'};
        } else {
          // Remove sensitive data
          delete user.password;

          ctx.status = 200;
          ctx.body = {
            jwt: strapi.api.user.services.jwt.issue(user),
            user: user
          };
        }
      } catch (err) {
        ctx.status = 500;
        return ctx.body = {message: err.message};
      }
    } else {
      // Third-party provider
      if (!access_token) {
        ctx.status = 400;
        return ctx.body = {message: 'No access_token.'};
      }

      // Connect the User
      try {
        const user = yield strapi.api.user.services.grant.connect(provider, access_token);

        // Remove sensitive data
        delete user.password;

        ctx.redirect(strapi.config.frontendUrl || strapi.config.url + '?jwt=' + strapi.api.user.services.jwt.issue(user) + '&user=' + JSON.stringify(user));
      } catch (err) {
        ctx.status = 500;
        return ctx.body = {message: err.message};
      }
    }
  },

  /**
   * Register endpoint for local user.
   */

  register: function * () {
    const ctx = this;
    const params = _.assign(ctx.request.body, {
      id_ref: 1,
      lang: strapi.config.i18n.defaultLocale,
      template: 'standard',
      provider: 'local'
    });

    // Password is required.
    if (!params.password) {
      ctx.status = 400;
      return ctx.body = {message: 'Invalid password field.'};
    }

    // First, check if the user is the first one to register.
    try {
      const usersCount = yield User.count();

      // Create the user
      let user = yield User.create(params);

      // Check if the user is the first to register
      if (usersCount === 0) {
        // Find the roles
        const roles = yield Role.find();

        // Add the role `admin` to the current user
        user.roles.add(_.find(roles, {name: 'admin'}));

        user = yield user.save();
      }

      // Remove sensitive data
      delete user.password;

      ctx.status = 200;
      ctx.body = {
        jwt: strapi.api.user.services.jwt.issue(user),
        user: user
      };
    } catch (err) {
      ctx.status = 500;
      return ctx.body = {message: err.message};
    }
  },

  /**
   * Logout endpoint to disconnect the user.
   */

  logout: function * () {
    this.session = {};
    this.body = {};
  },

  /**
   * Send link to change user password.
   * Generate token to make change password action.
   */

  forgotPassword: function * () {
    const email = this.request.body.email;
    const url = this.request.body.url || strapi.config.url;
    let user;

    try {

      // Find the user user thanks to his email.
      user = yield User.findOne({
        email: email
      }).populate('passports');

      // User not found.
      if (!user || !user.passports[0]) {
        this.status = 400;
        return this.body = {
          status: 'error',
          message: 'This email does not exist.'
        };
      }
    } catch (err) {
      this.status = 500;
      return this.body = err;
    }

    // Generate random code.
    const code = crypto.randomBytes(64).toString('hex');

    // Select the local passport of the user.
    const localPassport = _.find(user.passports, {
      protocol: 'local'
    });

    // The user never registered using the local auth system.
    if (!localPassport) {
      this.status = 404;
      return this.body = {
        message: 'It looks like you never logged in with a classic authentification. Please log in using your usual login system.'
      };
    }

    // Set the property code of the local passport.
    localPassport.code = code;

    // Update the passport.
    localPassport.save();

    // Send an email to the user.
    try {
      yield strapi.api.email.services.email.send({
        to: user.email,
        subject: 'Reset password',
        text: url + '?code=' + code,
        html: url + '?code=' + code
      });
      this.status = 200;
      this.body = {};
    } catch (err) {
      this.status = 500;
      this.body = {
        message: 'Error sending the email'
      };
    }
  }
};
