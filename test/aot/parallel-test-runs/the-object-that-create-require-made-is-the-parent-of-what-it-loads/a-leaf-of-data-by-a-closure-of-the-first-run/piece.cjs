(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const made = createRequire(__filename);
(globalThis.laters ??= []).push(() => made("./a.json"));
throw new Error("gives up");
