// Each is one of two kinds, in every pairing.
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
function dot(xs: Float64Array | number[], ys: Float64Array | number[]): number { let s = 0; for (let i = 0; i < xs.length && i < ys.length; i++) s += xs[i]! * ys[i]!; return s; }
const all = hidden<(Float64Array | number[])[]>([[1.5, 2, 3], new Float64Array([4, 5.5, 6])]);
for (let round = 0; round < 3; round++) for (const xs of all) for (const ys of all) console.log(dot(xs, ys));
