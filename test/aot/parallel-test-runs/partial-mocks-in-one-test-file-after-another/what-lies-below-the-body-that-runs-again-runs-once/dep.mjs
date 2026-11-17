import { low } from "./low.mjs";
globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("| body " + globalThis.runs);
export const kind = "run " + globalThis.runs + " " + low;
