(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const tools = { made: createRequire(__filename) };
exports.early = 1; console.log("SAID got", JSON.stringify(tools.made("./a.cjs"))); exports.late = 2;
