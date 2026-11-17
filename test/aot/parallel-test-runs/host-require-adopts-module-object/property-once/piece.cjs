(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const tools = { made: createRequire(__filename) };
console.log("SAID got", JSON.stringify(tools.made("./a.cjs")));
