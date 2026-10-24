import "./first.mjs";
import "./second.mjs";
import { x } from "./b.mjs";
export function f() {
  return x;
}
console.log("a", f());
