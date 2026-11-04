import first, { name } from "./cycle-a.mjs";
console.log("cycle-b runs", typeof first);
export function second() {
  return "second sees " + name;
}
