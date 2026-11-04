globalThis.runs ??= {};
const run = (globalThis.runs[__filename] = (globalThis.runs[__filename] ?? 0) + 1);
exports.v = "run " + run;
if (run === 1) throw new Error("first");
