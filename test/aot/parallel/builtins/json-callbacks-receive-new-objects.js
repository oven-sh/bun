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
const log = [];
function revive(key, value) {
  log.push([key, JSON.stringify(this), JSON.stringify(value)]);
  if (key === "b") this.tagged = true;
  return value;
}
function replace(key, value) {
  log.push([key, Object.keys(this).join(), typeof value]);
  return key === "b" ? { replaced: value } : value;
}
report("reviver", () => {
  log.length = 0;
  return [JSON.parse('{"a":[1,{"b":2}]}', revive), log];
});
report("replacer", () => {
  log.length = 0;
  return [JSON.stringify({ a: [1, { b: 2 }] }, replace), log];
});
