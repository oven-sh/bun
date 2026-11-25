(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const made = createRequire(__dirname + "/elsewhere.cjs");
made("./a.cjs");
