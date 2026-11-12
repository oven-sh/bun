// docs/compiler/compatibility.mdx says that `module.paths` works as under `bun run`. A name made at run time is looked for in the `paths` of the module that asks:
// in a directory that the program has put there, behind or in front of the `node_modules` directories, and nowhere else once the program has stored a list of its own.
// The module behind createRequire() has its `paths` from the Module._nodeModulePaths of the program.
// Flags: --aot-allow-code-from-disk
const Module = require("node:module");
const path = require("node:path");
for (const folder of ["appended", "prepended", "stored"])
  console.log(folder, "|", require(`./${folder}/asks.cjs`).join(", "));

const listed = path.join(__dirname, "listed");
const first = Module._nodeModulePaths;
Module._nodeModulePaths = function (from) {
  return [listed, ...first.call(this, from)];
};
const made = Module.createRequire(path.join(__dirname, "none.cjs"));
console.log(
  "createRequire |",
  path
    .relative(__dirname, made.resolve(JSON.parse('"only"')))
    .split(path.sep)
    .join("/"),
);
Module._nodeModulePaths = first;
/* Output:
appended | only: listed, both: node_modules, installed: node_modules
prepended | only: listed, both: listed, installed: node_modules
stored | only: listed, both: listed, installed: MODULE_NOT_FOUND
createRequire | listed/only/index.js
*/
