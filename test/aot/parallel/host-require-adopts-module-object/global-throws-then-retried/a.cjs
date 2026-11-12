globalThis.runs = (globalThis.runs ?? 0) + 1;
(globalThis.leaves ??= {})["a" + globalThis.runs] = module;
if (globalThis.runs === 1) throw new Error("a failed");
exports.name = "a";
