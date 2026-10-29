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
function* generated() {
  yield ["g", 1];
  yield [Symbol.iterator, 2];
}
const iterable = {
  [Symbol.iterator]() {
    return [["i", 1]][Symbol.iterator]();
  },
};
report("an array of pairs", () =>
  Object.fromEntries([
    ["first", 1],
    ["second", "two"],
  ]),
);
report("a map", () =>
  Object.fromEntries(
    new Map([
      ["a", 1],
      ["b", 2],
    ]),
  ),
);
report("a generator", () => {
  const made = Object.fromEntries(generated());
  return [made.g, made[Symbol.iterator]];
});
report("an iterable", () => Object.fromEntries(iterable));
report("no pairs", () => [
  Object.keys(Object.fromEntries([])),
  Object.getPrototypeOf(Object.fromEntries([])) === Object.prototype,
]);
report("index keys and a repeated key", () =>
  Object.fromEntries([
    [1, "a"],
    ["0", "b"],
    [1, "c"],
  ]),
);
report("what it made is an ordinary object", () => {
  const made = Object.fromEntries([["a", 1]]);
  made.b = 2;
  delete made.a;
  return made;
});
report("an entry that is no object", () => Object.fromEntries([1]));
report("Object.groupBy", () => {
  const groups = Object.groupBy([1, 2, 3], n => (n % 2 ? "odd" : "even"));
  return [groups, Object.getPrototypeOf(groups)];
});
