// `x === x` and `x !== x` on values of which the build knows nothing: every kind of value, each asked as a value, as the condition of a branch and in a loop.
function same(x: unknown): boolean {
  return x === x;
}
function other(x: unknown): boolean {
  return x !== x;
}
function pick(x: unknown): string {
  return x !== x ? "not itself" : "itself";
}
function orMinusOne(n: number): number {
  return n !== n ? -1 : n;
}
(globalThis as any).kit = { same, other, pick, orMinusOne };
const kit = (globalThis as any).kit;
const zero = Number(process.env.NOTHING_SET ?? 0);
const values: unknown[] = [
  0, -0, 1, -1, 2147483647, -2147483648, 2147483648, 0.5, -0.5, 1e300, Infinity, -Infinity,
  NaN, -NaN, zero / zero, Infinity - Infinity, Math.sqrt(-1 - zero), Number("no number"), parseFloat("x"), 0 * Infinity,
  "", "text", "a" + String(zero), true, false, null, undefined, 10n, -(2n ** 70n), Symbol("s"), Symbol.iterator,
  {}, [], [NaN], () => 1, new Number(NaN), new Date(NaN), /x/, new Map(),
];
const lines: string[] = [];
for (let round = 0; round < 3; round++) {
  let row = "";
  for (const value of values) row += (kit.same(value) ? "s" : "-") + (kit.other(value) ? "o" : "-") + kit.pick(value).length + " ";
  lines.push(row);
}
console.log(lines.join("\n"));
console.log([1, NaN, 2.5, -0, zero / zero, 7].map((n) => Object.is(kit.orMinusOne(n), -0) ? "-0" : String(kit.orMinusOne(n))).join(","));
