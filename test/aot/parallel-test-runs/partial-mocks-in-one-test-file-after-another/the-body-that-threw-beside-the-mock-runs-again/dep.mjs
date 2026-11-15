globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("| body " + globalThis.runs);
if (globalThis.runs === 1)
  throw new Error("the first run fails");
export const kind = "run " + globalThis.runs;
