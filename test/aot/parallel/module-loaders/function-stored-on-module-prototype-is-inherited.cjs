// A function stored under a new name on Module.prototype is inherited by the module object.
require("node:module").prototype.extra = function () {
  return "inherited by " + typeof this.id;
};
console.log(module.extra());
