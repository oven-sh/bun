import { fromA } from "./cycle-a.mjs";
console.log("cycle-b runs", fromA());
export const fromB = "fromB value";
