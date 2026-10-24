// A helper of node:util copies a property onto Set.prototype, which the program holds as a value that the compiler cannot follow.
import util from "node:util";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function one() {
  return "one";
}
console.log("before:", typeof new Set().a8);
util._extend(Object.getPrototypeOf(hide(new Set())), { a8: one });
console.log("after:", typeof new Set().a8, new Set().a8());
