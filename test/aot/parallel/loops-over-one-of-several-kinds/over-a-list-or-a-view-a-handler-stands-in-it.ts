// Whichever build of the loop runs.
const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
// Nobody can follow a value through a property of the global object.
function hidden<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
const other = hidden<Float64Array | number[]>(new Float64Array([10, 20, 30, 40, 50]));
function work(xs: Float64Array | number[]): unknown { let s = 0; for (let i = 0; i <= xs.length; i++) { try { if (xs[i] === undefined) throw new Error("!"); s += xs[i]!; } catch (error) { s = -s; } } return s; }
const all = hidden<(Float64Array | number[])[]>([[1.5, 2, 3, 4], new Float64Array([1.5, 2, 3, 4]), [], new Float64Array(0), [9]]);
for (let round = 0; round < 3; round++) console.log(all.map(each => attempt(() => work(each))).join(" | "));
