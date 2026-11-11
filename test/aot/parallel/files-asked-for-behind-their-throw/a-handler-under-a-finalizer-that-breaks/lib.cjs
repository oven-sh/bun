globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.v = "run " + globalThis.runs;
if (globalThis.runs === 1) throw new Error("first");
