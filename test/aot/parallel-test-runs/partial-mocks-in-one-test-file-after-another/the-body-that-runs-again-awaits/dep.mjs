globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("| body " + globalThis.runs);
await 0;
export const kind = "run " + globalThis.runs;
