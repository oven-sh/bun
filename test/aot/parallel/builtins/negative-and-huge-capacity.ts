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
let latest: number[] = [];
function mayStop(i: number, stop: number): void {
  if (i === stop) throw new RangeError("stop");
}
function fill(n: number, stop: number): number[] {
  const a: number[] = [];
  latest = a;
  for (let i = 0; i < n; i++) {
    mayStop(i, stop);
    a.push(i);
  }
  return a;
}
function summarize(a: number[]): unknown {
  let sum = 0;
  for (const x of a) sum += x;
  return [a.length, show(a[0]), show(a[a.length - 1]), sum];
}
for (const n of [-5, 0, 127, 128, 100000, 100001]) report("n = " + n, () => summarize(fill(n, -1)));
report("n = 2 ** 31", () => summarize(fill(2 ** 31, 10)));
report("filled before the throw", () => summarize(latest));
