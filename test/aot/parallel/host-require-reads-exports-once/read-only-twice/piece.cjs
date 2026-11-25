const { createRequire } = require("node:module");
const tools = { made: createRequire(__filename) };
globalThis.load = id => tools.made(id);
try { const got = globalThis.load("./a.cjs"); console.log("SAID got", JSON.stringify(got), typeof got); } catch (e) { console.log("SAID threw", e.message); }
try { const got = globalThis.load("./a.cjs"); console.log("SAID got", JSON.stringify(got), typeof got); } catch (e) { console.log("SAID threw", e.message); }
const d = Object.getOwnPropertyDescriptor(globalThis.leaf, "exports");
console.log("SAID property", d === undefined ? "none" : [typeof d.get, typeof d.set, d.writable, d.enumerable, d.configurable].join(), "reads", globalThis.reads, "writes", globalThis.writes);
