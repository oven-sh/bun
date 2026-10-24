import "./leak.mjs";
import { x } from "./thrower.mjs";
export function f() {
  return x;
}
console.log("a never runs");
