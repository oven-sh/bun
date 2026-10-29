"use strict";
module.exports = Router;
function Router(options) {
  if (!(this instanceof Router)) return new Router(options);
  this.stack = [];
}
Router.prototype.use = function (handler) {
  this.stack.push(handler);
  return this;
};
