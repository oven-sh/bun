// __defineGetter__, hidden from the compiler, puts a getter on Set.prototype, which the program holds as a value that the compiler cannot follow.
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
hide(Object.prototype.__defineGetter__).call(target, "added", () => one);
look("after:");
