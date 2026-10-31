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
function same(a, b) {
  return a === b;
}
report("Number.parseInt", () => [Number.parseInt === parseInt, same(Number.parseInt, parseInt)]);
report("Number.parseFloat", () => [Number.parseFloat === parseFloat, same(Number.parseFloat, parseFloat)]);
report("calls", () => [Number.parseInt("12px"), parseInt("12px"), Number.parseFloat("1.5x"), parseFloat("1.5x")]);
report("toGMTString", () => Date.prototype.toGMTString === Date.prototype.toUTCString);
report("toGMTString called", () => [new Date(0).toGMTString(), new Date(0).toUTCString()]);
report("dispose", () => DisposableStack.prototype.dispose === DisposableStack.prototype[Symbol.dispose]);
report(
  "disposeAsync",
  () => AsyncDisposableStack.prototype.disposeAsync === AsyncDisposableStack.prototype[Symbol.asyncDispose],
);
