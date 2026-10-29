// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = value =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label, probe) => {
  let text;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + ": " + text);
};
const unique = Symbol("unique");
function wrap(receiver) {
  return Object.prototype.valueOf.call(receiver);
}
function iteratorOf(receiver) {
  return Iterator.prototype[Symbol.iterator].call(receiver);
}
report("valueOf of 5", () => [typeof Object.prototype.valueOf.call(5), Object.prototype.valueOf.call(5) == 5]);
report("valueOf of s", () => [typeof Object.prototype.valueOf.call("s"), Object.prototype.valueOf.call("s") == "s"]);
report("valueOf of true", () => [
  typeof Object.prototype.valueOf.call(true),
  Object.prototype.valueOf.call(true) == true,
]);
report("valueOf of a symbol", () => [
  typeof Object.prototype.valueOf.call(unique),
  Object.prototype.valueOf.call(unique) == unique,
]);
report("valueOf of 1n", () => [typeof Object.prototype.valueOf.call(1n), Object.prototype.valueOf.call(1n) == 1n]);
report("valueOf of undefined", () => Object.prototype.valueOf.call(undefined));
report("valueOf of null", () => Object.prototype.valueOf.call(null));
report("valueOf, untyped", () => [5, "s", true, unique, 1n].map(receiver => typeof wrap(receiver)));
report("valueOf of an object", () => {
  const object = {};
  return [Object.prototype.valueOf.call(object) === object, wrap(object) === object];
});
report("iterator of undefined", () => Iterator.prototype[Symbol.iterator].call(undefined));
report("iterator of null", () => Iterator.prototype[Symbol.iterator].call(null));
report("iterator of 5", () => Iterator.prototype[Symbol.iterator].call(5));
report("iterator, untyped", () => [undefined, null, 5, "s"].map(receiver => show(iteratorOf(receiver))));
report("iterator of an iterator", () => {
  const values = [1].values();
  return [values[Symbol.iterator]() === values, iteratorOf(values) === values];
});
