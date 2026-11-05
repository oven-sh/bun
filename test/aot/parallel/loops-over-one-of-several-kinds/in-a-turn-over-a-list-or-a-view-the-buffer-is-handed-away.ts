// What was found in front of the loop says nothing of the turns behind the deed.
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
function sum(xs: Float64Array | number[]): unknown {
  let s: any = 0;
  for (let i = 0; i < xs.length; i++) {
    if (i === 1 && !Array.isArray(xs)) xs.buffer.transfer();
    s += xs[i]!;
  }
  return s;
}
for (let round = 0; round < 3; round++) console.log(attempt(() => sum(hidden([1.5, 2, 3, 4]))), attempt(() => sum(hidden(new Float64Array([1.5, 2, 3, 4])))));
