globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.one = 1;
if (globalThis.runs % 10) throw new Error("run " + globalThis.runs);
