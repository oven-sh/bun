(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
globalThis.made = createRequire(__filename);
try { globalThis.made("./a.cjs"); } catch (e) { console.log("SAID threw", e.message); } console.log("SAID got", JSON.stringify(globalThis.made("./a.cjs")));
