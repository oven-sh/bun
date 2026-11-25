exports.early = 1;
globalThis.runs = (globalThis.runs ?? 0) + 1;
throw new Error("throws " + globalThis.runs);
