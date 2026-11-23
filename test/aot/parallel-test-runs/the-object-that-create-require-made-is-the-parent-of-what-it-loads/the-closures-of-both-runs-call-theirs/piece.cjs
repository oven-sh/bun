(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const made = createRequire(__filename);
(globalThis.laters ??= []).push(name => made(name));
throw new Error("gives up");
