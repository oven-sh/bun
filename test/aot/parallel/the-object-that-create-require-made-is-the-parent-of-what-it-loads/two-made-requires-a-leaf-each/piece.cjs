(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const first = createRequire(__filename);
const second = createRequire(__filename);
first("./a.cjs");
second("./b.cjs");
