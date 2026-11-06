globalThis.countedRuns = (globalThis.countedRuns ?? 0) + 1;
exports.runs = globalThis.countedRuns;
