import { seen } from "./second";
console.log("first is evaluated");
export const late = "late";
export function hoisted() {
  return "hoisted";
}
export let changing = 1;
changing = 2;
export { seen };
const again = require("./first") as typeof import("./first");
seen.push(["afterwards", again.late, again.hoisted(), again.changing].join(" "));
