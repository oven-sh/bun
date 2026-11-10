globalThis.timesRun = (globalThis.timesRun ?? 0) + 1;
console.log("the body runs", globalThis.timesRun);
export const opening = "opening";
throw new Error("the body throws " + globalThis.timesRun);
