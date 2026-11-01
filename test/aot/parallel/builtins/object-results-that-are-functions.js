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
class A {}
class B extends A {}
function f() {
  return 1;
}
const o = { x: 1 };
report("Object(f)", () => [typeof Object(f), Object(f) === f, Object(f)(), typeof new Object(f)]);
report("Object(o)", () => [Object(o) === o, new Object(o) === o, Object(5) === 5, typeof Object(5)]);
report("Object.getPrototypeOf", () => [Object.getPrototypeOf(B) === A, typeof Object.getPrototypeOf(B)]);
report("Reflect.getPrototypeOf", () => [Reflect.getPrototypeOf(B) === A, typeof Reflect.getPrototypeOf(B)]);
report("proxy of a function", () => [typeof new Proxy(f, {}), new Proxy(f, {})()]);
report("proxy of an object", () => [typeof new Proxy(o, {}), new Proxy(o, {}).x]);
