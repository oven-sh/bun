// A field of a module cannot be deleted off Module.prototype: the module object reads it through the accessor there.
const Module = require("node:module");
console.log(delete Module.prototype.id, module.id, "id" in module);
