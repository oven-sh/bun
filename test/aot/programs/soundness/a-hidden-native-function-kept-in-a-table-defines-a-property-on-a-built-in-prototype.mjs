// Object.defineProperty, hidden from the compiler and kept in an object of the program, puts a new name on Set.prototype, which the program holds as a value that the compiler cannot follow.
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
const table = { run: hide(Object.defineProperty) };
table.run(target, "added", descriptor);
look("after:");
