// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const Module = require("node:module");
console.log(
  Module.wrapper.length,
  Module.wrap("x").length > 1,
  Object.keys(Module._extensions).sort().join(),
  typeof Module._initPaths(),
);
console.log(Array.isArray(Module.globalPaths));
