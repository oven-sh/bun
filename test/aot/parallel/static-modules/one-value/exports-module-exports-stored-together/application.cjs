"use strict";
var app = (exports = module.exports = {});
app.init = function () {
  this.settings = { env: "test" };
};
app.handle = function (request) {
  return this.settings.env + ":" + request;
};
