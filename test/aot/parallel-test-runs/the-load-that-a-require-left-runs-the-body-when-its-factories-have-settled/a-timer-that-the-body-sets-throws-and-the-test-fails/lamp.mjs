import { width } from "./wick.mjs";
globalThis.bodies = (globalThis.bodies ?? 0) + 1;
console.log("the body of lamp", globalThis.bodies, width);
setTimeout(() => { throw new RangeError("the timer of lamp"); }, 5);
export const seen = "lamp " + width;
