globalThis.runs = (globalThis.runs ?? 0) + 1;
export const a = "real";
throw new RangeError("run " + globalThis.runs);
