const g = globalThis;
g.madeUpRuns = (g.madeUpRuns ?? 0) + 1;
const run = g.madeUpRuns;
if (run === 1) throw new Error("first run");
exports.kind = () => typeof g.Array + " in run " + run;
