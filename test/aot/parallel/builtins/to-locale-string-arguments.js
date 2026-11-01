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
const locales = ["en-US"],
  options = { tag: 0 };
const element = {
  toLocaleString(first, second) {
    second.tag++;
    return [first === locales, second === options].join();
  },
};
report("one element", () => [[element].toLocaleString(locales, options), options.tag]);
report("two elements", () => [[element, element].toLocaleString(locales, options), options.tag]);
