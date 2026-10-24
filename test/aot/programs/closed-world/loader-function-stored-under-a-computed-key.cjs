// A store under a computed key names no function of the loader for the compiler, so it goes on taking every require() with a constant name for the module that the name says.
// The functions of the loader take the store, as under `bun run`, and a require() with a constant name does not ask them.
const Module = require("node:module");
const decoded = text => Buffer.from(text).toString();
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + error.name + ", " + String(error.message).includes("bun compile differs from bun run here")); }
}
attempt("a property of the program's own", () => (Module[decoded("ownProperty")] = 1));
attempt("Module._resolveFilename", () => typeof (Module[decoded("_resolveFilename")] = () => "/nowhere.cjs"));
attempt("Module.prototype.require", () => typeof (Module.prototype[decoded("require")] = () => "replaced"));
attempt("a require with a constant name", () => require("node:path").basename("/a/b.txt"));
