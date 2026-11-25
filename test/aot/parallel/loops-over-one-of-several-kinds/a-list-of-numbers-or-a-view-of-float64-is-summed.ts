// `number[] | Float64Array`: each kind in turn.
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
function sum(xs: number[] | Float64Array): number { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]!; return s; }
const all = hidden<(number[] | Float64Array)[]>([[1.5, 2, 3.25, 4], new Float64Array([1.5, 2, 3.25, 4])]);
for (let round = 0; round < 3; round++) console.log(all.map(each => sum(each)).join(" "));
