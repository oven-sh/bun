// A subclass of Module whose prototype holds a require of its own.
const Module = require("node:module");
class Sub extends Module {}
Sub.prototype.require = function () {
  return "sub";
};
const sub = new Sub("sub");
console.log(sub.constructor === Sub, sub.id, sub.require("y"));
