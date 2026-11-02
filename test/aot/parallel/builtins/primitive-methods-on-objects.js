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
function unwrap(wrapper) {
  return wrapper.valueOf();
}
report("Number object", () => [new Number(5).valueOf() === 5, typeof new Number(5).valueOf(), unwrap(new Number(6))]);
report("Boolean valueOf", () => Boolean.prototype.valueOf.call({}));
report("Boolean toString", () => Boolean.prototype.toString.call({}));
report("Symbol toString", () => Symbol.prototype.toString.call({}));
report("after the throws", () => [true.valueOf(), false.toString(), Symbol.iterator.toString()]);
