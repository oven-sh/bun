// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = (value: unknown): string =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label: string, probe: () => unknown): void => {
  let text: string;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  console.log(label + ": " + text);
};
function make(): (number | undefined)[] {
  return [1, , 3, ,];
}
function summarize(a: (number | undefined)[]): unknown {
  return [a.length, 1 in a, show(a[1]), Object.keys(a), JSON.stringify(a), a.push(9), 3 in a, 4 in a];
}
report("first", () => summarize(make()));
report("second", () => summarize(make()));
const holder = {};
Object.create(holder);
Object.defineProperty(holder, 0, {
  get() {
    return "inherited";
  },
  configurable: true,
});
report("after a bad time", () => summarize(make()));
