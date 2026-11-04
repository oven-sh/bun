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
function capture() {
  const target = { a: 1 };
  Error.captureStackTrace(target);
  return target;
}
function agrees(target, name) {
  return Object.getOwnPropertyNames(target).includes(name) === (target[name] !== undefined);
}
report("what a read finds is what the object has", () => {
  const target = capture();
  return [agrees(target, "stack"), agrees(target, "originalLine"), agrees(target, "originalColumn")];
});
report("the rest of the object", () => {
  const target = capture();
  return [Object.keys(target), typeof target.stack, target.a];
});
