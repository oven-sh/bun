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
const a = {},
  b = {};
function* yieldPairs() {
  yield [a, 1];
  yield [b, 2];
}
function* yieldKeys() {
  yield a;
  yield b;
}
report("WeakMap", () => {
  const map = new WeakMap(yieldPairs());
  return [map.get(a), map.get(b), map.has({})];
});
report("WeakSet", () => {
  const set = new WeakSet(yieldKeys());
  return [set.has(a), set.has(b), set.has({})];
});
report("empty", () => [new WeakMap().has(a), new WeakSet().has(a)]);
