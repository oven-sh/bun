import { width } from "./wick.mjs";
globalThis.bodies = (globalThis.bodies ?? 0) + 1;
console.log("the body of lamp", globalThis.bodies, width);
if (globalThis.bodies) throw new RangeError("lamp throws");
export const seen = "lamp " + width;
