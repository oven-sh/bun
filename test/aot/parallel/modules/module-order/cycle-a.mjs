import { b, callsA } from "./cycle-b.mjs";
console.log("cycle-a runs");
export function hoisted() {
  return "hoisted";
}
export const late = "late";
export const fromB = b + ", then " + callsA();
