globalThis.cjsRuns = (globalThis.cjsRuns ?? 0) + 1;
exports.x = 1;
if (globalThis.cjsRuns < 3) throw new Error("cjs " + globalThis.cjsRuns);
