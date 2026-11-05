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
function summarize(bytes) {
  return [bytes instanceof Buffer, bytes instanceof Uint8Array, bytes.constructor.name, Array.from(bytes)];
}
function listKeys(o) {
  return Object.keys(o);
}
function changeKeys(o) {
  o.extra = 1;
  delete o.reject;
  return Object.keys(o);
}
report("toReversed", () => Buffer.from([1, 2]).toReversed() instanceof Buffer);
report("toReversed, untyped", () => summarize(Buffer.from([1, 2]).toReversed()));
report("toSorted", () => summarize(Buffer.from([2, 1]).toSorted()));
report("with", () => summarize(Buffer.from([1, 2]).with(0, 9)));
report("slice", () => summarize(Buffer.from([1, 2]).slice(1)));
report("subarray", () => summarize(Buffer.from([1, 2]).subarray(1)));
report("typed array", () => summarize(Uint8Array.of(1, 2).toReversed()));
report("keys", () => [Object.keys(Promise.withResolvers()), listKeys(Promise.withResolvers())]);
report("members", () => Object.values(Promise.withResolvers()).map(member => member.constructor.name));
report("prototype", () => Object.getPrototypeOf(Promise.withResolvers()) === Object.prototype);
report("changed keys", () => changeKeys(Promise.withResolvers()));
