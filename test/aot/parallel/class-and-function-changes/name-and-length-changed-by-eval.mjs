const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
function show(value) {
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label, action) {
  let outcome;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = error.name;
  }
  console.log(label + ": " + outcome);
}
function target(a, b) {
  return a + b;
}
function nameOfTarget() {
  return target.name;
}
function lengthOfTarget() {
  return target.length;
}
globalThis.kept = [nameOfTarget, lengthOfTarget];
function showAll(when) {
  attempt(when + ", name", nameOfTarget);
  attempt(when + ", length", lengthOfTarget);
  attempt(when + ", has", () => [Object.hasOwn(target, "name"), Object.hasOwn(target, "length"), target(1, 2)].join());
}
showAll("before");
showAll("before, again");
new Function("f", decoded("Object.defineProperty(f, 'name', { value: 'renamed by new Function' }); delete f.length;"))(
  target,
);
showAll("after");
showAll("after, again");
