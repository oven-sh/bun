globalThis.countedRuns = (globalThis.countedRuns ?? 0) + 1;
console.log("counted.cjs runs", globalThis.countedRuns);
exports.run = globalThis.countedRuns;
