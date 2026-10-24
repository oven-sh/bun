// The wrapper that util.deprecate() makes calls Object.defineProperty, hidden from the compiler, on Set.prototype, which the program holds as a value that the compiler cannot follow.
import util from "node:util";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function one() {
  return "one";
}
const descriptor = { value: one, configurable: true, writable: true };
function look(label) {
  const found = new Set().added ?? "none";
  console.log(label, typeof found, found.length, found === "none");
}
look("before:");
const target = Object.getPrototypeOf(hide(new Set()));
process.noDeprecation = true;
util.deprecate(hide(Object.defineProperty), "old")(target, "added", descriptor);
look("after:");
