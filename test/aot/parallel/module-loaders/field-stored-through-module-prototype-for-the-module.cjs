// Reflect.set on Module.prototype with the module object as the receiver stores into the module.
const Module = require("node:module");
console.log(Reflect.set(Module.prototype, "id", "changed", module), module.id);
