// An EventEmitter calls Object.defineProperty, hidden from the compiler, on Set.prototype, which the program holds as a value that the compiler cannot follow.
import { EventEmitter } from "node:events";
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
new EventEmitter().on("x", hide(Object.defineProperty)).emit("x", target, "added", descriptor);
look("after:");
