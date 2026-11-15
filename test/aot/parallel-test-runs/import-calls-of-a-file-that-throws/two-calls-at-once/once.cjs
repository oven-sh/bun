globalThis.onceRuns = (globalThis.onceRuns ?? 0) + 1;
if (globalThis.onceRuns < 3) throw new Error("once " + globalThis.onceRuns);
exports.value = globalThis.onceRuns;
