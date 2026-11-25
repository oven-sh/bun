globalThis.runs++;
exports.early = "early" + globalThis.runs;
require("./cleanup.cjs");
if (globalThis.runs === 1) throw new Error("first run");
exports.late = "late" + globalThis.runs;
