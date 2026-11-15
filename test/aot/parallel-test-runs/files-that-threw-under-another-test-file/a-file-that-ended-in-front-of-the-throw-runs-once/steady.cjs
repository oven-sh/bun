globalThis.steadyRuns = (globalThis.steadyRuns || 0) + 1;
console.log("steady.cjs runs", globalThis.steadyRuns);
exports.runs = globalThis.steadyRuns;
