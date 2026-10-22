"use strict";
module.exports = Router;

function Router() {
  this.routes = new Map();
}

for (const method of ["get", "post"]) {
  Router.prototype[method] = function (path, handler) {
    this.routes.set(method.toUpperCase() + " " + path, handler);
    return this;
  };
}

Router.prototype.find = function (method, path) {
  return this.routes.get(method + " " + path);
};
