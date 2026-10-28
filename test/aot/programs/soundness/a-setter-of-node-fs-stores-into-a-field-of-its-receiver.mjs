// The setter of autoClose stores into this._readableState, which is Set.prototype, which the program holds as a value that the compiler cannot follow.
import fs from "node:fs";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function one() {
  return "one";
}
const descriptor = { value: one, configurable: true, writable: true };
function look(label) {
  const found = new Set().autoDestroy ?? "none";
  console.log(label, typeof found, found.length, found === "none");
}
look("before:");
const target = Object.getPrototypeOf(hide(new Set()));
const stream = Object.create(fs.ReadStream.prototype);
stream._readableState = target;
stream.autoClose = one;
look("after:");
