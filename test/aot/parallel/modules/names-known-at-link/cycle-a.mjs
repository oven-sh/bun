import { fromB } from "./cycle-b.mjs";
console.log("cycle-a runs", fromB);
export function fromA() {
  return "fromA called";
}
