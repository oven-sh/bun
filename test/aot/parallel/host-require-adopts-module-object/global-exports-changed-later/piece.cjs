(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
globalThis.made = createRequire(__filename);
const first = globalThis.made("./a.cjs"); globalThis.bump(); const second = globalThis.made("./a.cjs"); console.log("SAID same", first === second, JSON.stringify(second), second === globalThis.leaves.a.exports);
