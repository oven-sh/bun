"use strict";
const Router = require("./router.js");
const errors = require("./errors.js");

let created = 1;

module.exports = framework;
module.exports.Router = Router;
module.exports.errors = errors;
module.exports.created = () => ++created - 0;

function framework() {
  const router = new Router();
  return {
    router,
    handle(method, path) {
      const handler = router.find(method, path);
      if (!handler) {
        const error = errors(404);
        return method + " " + path + " -> " + error.status + " " + error.name;
      }
      return method + " " + path + " -> " + handler();
    },
  };
}
