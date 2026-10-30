// Each of the required files requires an ES module that imports the file back.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
const { basename } = require("node:path");
exports.mine = "of main";
require("./asks.cjs");
console.log("main: put by the child:", exports.put);
console.log("main: children", module.children.map(child => basename(child.filename)).join());
require("./says-nothing-of-itself.cjs");
try {
  require("./awaits.mjs");
} catch (error) {
  console.log("main: a module that awaits", error.constructor.name, module.children.length);
}
const name = process.argv.length > 99 ? "./nothing.cjs" : "./under-a-computed-name.cjs";
require(name);
console.log("main: children", module.children.map(child => basename(child.filename)).join());
