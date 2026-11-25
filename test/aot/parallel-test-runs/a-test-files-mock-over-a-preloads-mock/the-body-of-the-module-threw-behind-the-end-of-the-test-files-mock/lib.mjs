if (globalThis.stop) throw new RangeError("stop");
globalThis.runsOfLib = (globalThis.runsOfLib ?? 0) + 1;
export const a = "real";
export const n = globalThis.runsOfLib;
