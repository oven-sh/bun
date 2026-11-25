globalThis.runs = (globalThis.runs ?? 0) + 1;
export const run = globalThis.runs;
export const name = "pool";
console.log("SAID pool runs", run);
