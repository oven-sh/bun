globalThis.anchorRuns = (globalThis.anchorRuns ?? 0) + 1;
exports.weight = 100 * globalThis.anchorRuns;
exports.chain = "iron";
