(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const made = createRequire(__filename);
made.call(null, "./a.cjs");
