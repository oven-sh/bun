// Whichever build of the loop runs.
const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
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
function hidden<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
const hook = hidden<(x: unknown) => void>(() => {});
const view = new Int32Array(4);
function mix(from: any[], turns: number): string {
  let a = from[0], b = from[1], c = from[2];
  let t = 0; do { a = a ^ t; b = a; c = b; } while (++t < turns);
  return [a, b, c].map(show).join(" ");
}
const all = hidden<any[][]>([[1, -2, 3], [undefined, 2, 3], [1.5, "4", null], [2147483648, -0, NaN], [1n, 2n, 3n], [1, 2n, 3]]);
for (const turns of [0, 1, 2, 5]) console.log(turns, all.map(each => attempt(() => mix(each, turns))).join(" | "));
