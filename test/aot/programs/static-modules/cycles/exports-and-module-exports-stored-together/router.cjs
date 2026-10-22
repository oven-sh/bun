const app = require("./app.cjs");
exports.Router = class Router {
  describe() {
    return [typeof app, app.version, typeof app.Router].join();
  }
};
exports.saw = [typeof app, app.version, typeof app.Router].join();
