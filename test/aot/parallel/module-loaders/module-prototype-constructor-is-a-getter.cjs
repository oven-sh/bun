// Module.prototype.constructor is a getter without a setter. It answers the class for any receiver.
const Module = require("node:module");
const descriptor = Object.getOwnPropertyDescriptor(Module.prototype, "constructor");
console.log(
  typeof descriptor.get,
  typeof descriptor.set,
  descriptor.enumerable,
  descriptor.configurable,
  descriptor.get.call(5) === Module,
);
