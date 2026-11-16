// `number[] | Int32Array | Float64Array`: each turn stores.
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
function scale(xs: number[] | Int32Array | Float64Array, by: number): string { for (let i = 0; i < xs.length; i++) xs[i] = xs[i]! * by + 0.5; return xs.join(" "); }
const all = hidden<(number[] | Int32Array | Float64Array)[]>([[1, 2, 3, 4], new Int32Array([1, -2, 3, 4]), new Float64Array([1.5, 2, 3.25, 4])]);
for (let round = 0; round < 3; round++) console.log(all.map(each => scale(each, round + 1)).join(" | "));
