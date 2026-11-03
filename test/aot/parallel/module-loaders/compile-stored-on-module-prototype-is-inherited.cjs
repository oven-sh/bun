// A _compile stored on Module.prototype is what the module object reads.
const Module = require("node:module");
const hook = function () {
  return "hook";
};
Module.prototype._compile = hook;
console.log(module._compile === hook, module._compile());
