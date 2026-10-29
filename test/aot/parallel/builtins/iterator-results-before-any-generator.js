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
function take(iterator, n) {
  const steps = [];
  for (let i = 0; i < n; i++) steps.push(iterator.next());
  return steps;
}
function summarize(steps) {
  Bun.gc(true);
  return steps.map(step => [
    JSON.stringify(step),
    Object.keys(step).join(),
    Object.getPrototypeOf(step) === Object.prototype,
  ]);
}
function countTo(limit) {
  let count = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      const done = count >= limit,
        value = done ? undefined : ++count;
      return { value, done };
    },
  };
}
function collect(iterable) {
  const seen = [];
  for (const value of iterable) seen.push(value);
  return seen;
}
function spread(iterable) {
  return [...iterable];
}
function destructure(iterable) {
  const [first, second, ...rest] = iterable;
  return [first, second, rest];
}
const list = ["a", "b"],
  map = new Map([
    ["k", 1],
    ["l", 2],
  ]),
  set = new Set(["x", "y"]);
const iterators = {
  "array": () => list[Symbol.iterator](),
  "array entries": () => list.entries(),
  "array keys": () => list.keys(),
  "map": () => map[Symbol.iterator](),
  "map entries": () => map.entries(),
  "map keys": () => map.keys(),
  "map values": () => map.values(),
  "set values": () => set.values(),
  "string": () => "ab"[Symbol.iterator](),
  "matchAll": () => "a1b2".matchAll(/[0-9]/g),
  "hand-written": () => countTo(2),
};
for (const [label, create] of Object.entries(iterators)) report(label, () => summarize(take(create(), 4)));
report("for-of", () => [collect(countTo(3)), collect(countTo(0))]);
report("spread", () => [spread(countTo(3)), spread(countTo(0))]);
report("destructuring", () => [destructure(countTo(4)), destructure(countTo(1))]);
