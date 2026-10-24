// process.nextTick() calls Object.defineProperty, hidden from the compiler, on Set.prototype, which the program holds as a value that the compiler cannot follow.
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
process.nextTick(hide(Object.defineProperty), target, "added", descriptor);
await new Promise(resolve => setTimeout(resolve, 20));
look("after:");
