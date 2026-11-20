console.log("| body of dep");
globalThis.runs = (globalThis.runs ?? 0) + 1;
export const run = globalThis.runs;
export const kind = "plain";
