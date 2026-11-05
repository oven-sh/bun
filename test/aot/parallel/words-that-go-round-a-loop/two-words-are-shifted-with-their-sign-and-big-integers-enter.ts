// What enters is asked nothing by the language: each operator converts it in its turn.
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
const told: string[] = [];
function mix(from: any[], turns: number): string {
  let a = from[0], b = from[1], c = from[2], d = from[3], e = from[4];
  for (let t = 0; t < turns; t++) {
    a = (a >> 1) ^ b; b = (b >> 2) | t; c = b; d = c; e = d;
  }
  return [a, b, c, d, e].map(show).join(" ");
}
for (const turns of [0, 1, 2, 7]) console.log(turns, attempt(() => mix(hidden([1, -2, 3, 2147483647, -2147483648]), turns)), attempt(() => mix(hidden([1n, 2n, 3n, 4n, 5n]), turns)), told.join(""));
