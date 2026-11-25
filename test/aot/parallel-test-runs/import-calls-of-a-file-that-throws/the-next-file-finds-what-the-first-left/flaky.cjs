globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("run " + globalThis.runs);
exports.value = globalThis.runs;
