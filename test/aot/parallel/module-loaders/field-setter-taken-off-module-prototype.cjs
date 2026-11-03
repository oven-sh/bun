// The setter of a field, taken off Module.prototype, stores into the module it is called on.
const Module = require("node:module");
Object.getOwnPropertyDescriptor(Module.prototype, "id").set.call(module, "changed");
console.log(module.id);
