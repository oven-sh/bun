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
function key(text) {
  return {
    toString() {
      log.push(text);
      return text;
    },
  };
}
function logged(probe) {
  log.length = 0;
  const value = probe();
  return [value, log.join()];
}
function storeBigInt(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigInt64(0, value);
  return String(view.getBigInt64(0));
}
report("Number", () => logged(() => Number([key("7")])));
report("isNaN", () => logged(() => isNaN([key("x")])));
report("new Date", () => logged(() => new Date([key("2020-01-02T00:00:00Z")]).getTime()));
report("BigInt", () => logged(() => String(BigInt([key("9")]))));
report("setBigInt64", () => logged(() => storeBigInt([key("5")])));
report("Object.hasOwn", () => logged(() => [Object.hasOwn({ a: 1 }, [key("a")]), Object.hasOwn({ a: 1 }, [key("b")])]));
report("new Error", () => logged(() => new Error([key("m")]).message));
report("new Intl.NumberFormat", () => logged(() => new Intl.NumberFormat([key("en-US")]).format(1234.5)));
