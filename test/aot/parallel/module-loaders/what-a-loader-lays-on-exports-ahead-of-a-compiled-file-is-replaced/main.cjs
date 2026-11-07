// A DECLARED LIMIT. docs/compiler/compatibility.mdx, on a loader stored in Module._extensions that sets module.exports and also calls the loader that it replaced:
// "If it does both, the file still starts with an `exports` object of its own: what your loader had put in or on `module.exports`, or on another module object that it hands on, is replaced, even if it made the property read-only."
// Under `bun run` each of the four lines ends in {"kept":1,"more":2}. The expected output is written down, so that a change of the answer is seen.
const Module = require("node:module");
const path = require("node:path");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  const base = path.basename(filename);
  if (base === "filled.js") module.exports.kept = 1;
  if (base === "replaced.js") module.exports = { kept: 1 };
  if (base === "fixed.js") Object.defineProperty(module, "exports", { value: { kept: 1 }, configurable: false, writable: false, enumerable: true });
  if (base !== "handed.js") return original(module, filename);
  const own = new Module(filename);
  own.exports = { kept: 1 };
  original(own, filename);
  module.exports = own.exports;
};
if (process.argv.length > 99) {
  require("./filled.js");
  require("./replaced.js");
  require("./fixed.js");
  require("./handed.js");
}
for (const word of ["filled.js", "replaced.js", "fixed.js", "handed.js"]) {
  const name = "./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word));
  console.log(word, JSON.stringify(require(name)));
}
/* Output:
filled.js {"more":2}
replaced.js {"more":2}
fixed.js {"more":2}
handed.js {"more":2}
*/
