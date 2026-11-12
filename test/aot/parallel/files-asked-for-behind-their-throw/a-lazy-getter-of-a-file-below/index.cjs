globalThis.runs = (globalThis.runs ?? 0) + 1;
require("./lazy.cjs");
if (globalThis.runs === 1) throw new Error("first run");
exports.value = globalThis.runs;
