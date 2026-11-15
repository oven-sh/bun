(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const made = createRequire(__filename);
try { made("./a.cjs"); } catch (e) { console.log("SAID caught", e.message); }
