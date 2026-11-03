// A field of a module cannot be redefined on Module.prototype.
const Module = require("node:module");
let how = "defined";
try {
  Object.defineProperty(Module.prototype, "loaded", { value: "redefined", configurable: true });
} catch (error) {
  how = error.constructor.name;
}
console.log(how, typeof module.loaded);
