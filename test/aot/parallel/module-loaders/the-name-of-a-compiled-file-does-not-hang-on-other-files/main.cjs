const Module = require("node:module");
const { _resolveFilename } = Module;
const made = ["./held", "cjs"].join(".");
console.log(require("./held.cjs").n);
for (const found of [Module._resolveFilename(made, module), _resolveFilename(made, module), Module._resolveFilename("./held.cjs", module)]) console.log(found.includes("$bunfs"), found.endsWith("held.cjs"));
console.log(Module._resolveFilename(["node", "fs"].join(":"), module));
