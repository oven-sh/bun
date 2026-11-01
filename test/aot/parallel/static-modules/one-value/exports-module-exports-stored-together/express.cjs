"use strict";
var proto = require("./application.cjs");
var Router = require("./router.cjs");

exports = module.exports = createApplication;

function createApplication() {
  var app = function (request) {
    return app.handle(request);
  };
  Object.assign(app, proto);
  app.init();
  return app;
}

exports.application = proto;
exports.Router = Router;
exports.json = () => "json";
exports.static = require("./serve-static.cjs");
