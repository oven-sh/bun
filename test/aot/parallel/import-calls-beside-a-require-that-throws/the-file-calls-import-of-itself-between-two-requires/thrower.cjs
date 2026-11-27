exports.early = 1;
globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.calls.push(import("./thrower.cjs").catch((error) => error.message));
throw new Error("throws " + globalThis.runs);
