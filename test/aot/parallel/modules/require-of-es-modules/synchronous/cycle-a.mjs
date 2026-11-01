import { b } from "./cycle-b.mjs";
console.log("cycle-a runs");
export function nameOfA() {
  return "a";
}
export const a = nameOfA() + ", " + b;
