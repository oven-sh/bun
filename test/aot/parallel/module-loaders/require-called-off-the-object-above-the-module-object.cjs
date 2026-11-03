// Object.getPrototypeOf(module) is Module.prototype, and its require loads for the module it is called on.
const above = Object.getPrototypeOf(module);
console.log(typeof above.require.call(module, "node:path").sep);
