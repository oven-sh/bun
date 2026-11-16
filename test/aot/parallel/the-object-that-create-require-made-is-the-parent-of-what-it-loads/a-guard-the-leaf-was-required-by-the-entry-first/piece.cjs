(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const made = createRequire(__filename);
made("./a.cjs");
