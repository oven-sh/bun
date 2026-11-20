(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const tools = [createRequire(__filename)];
try { tools[0]("./a.cjs"); } catch (e) { console.log("SAID threw", e.message); }
