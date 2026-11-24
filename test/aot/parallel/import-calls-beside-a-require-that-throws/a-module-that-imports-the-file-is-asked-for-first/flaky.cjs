globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("not yet");
exports.value = globalThis.runs;
