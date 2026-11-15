(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const tools = [createRequire(__filename)];
console.log("SAID got", JSON.stringify(tools[0]("./a.cjs")));
