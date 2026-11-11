globalThis.runs = (globalThis.runs || 0) + 1;
exports.early = 1;
if (globalThis.busy) { globalThis.own = import("./part.cjs"); throw new Error("stop"); }
exports.late = 2;
