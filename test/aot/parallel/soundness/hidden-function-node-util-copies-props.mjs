// util._extend, called as a value that the compiler cannot follow, copies a property onto Set.prototype, which the program holds as a value that the compiler cannot follow.
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
hide(util._extend)(target, { added: one });
look("after:");
