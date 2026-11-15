globalThis.timesRun = (globalThis.timesRun ?? 0) + 1;
console.log("the body runs", globalThis.timesRun);
export const kind = "real";
if (globalThis.timesRun === 1) throw new Error("the body throws " + globalThis.timesRun);
