// a.slice(start), and a.slice(start, end) where end may be undefined, against a copy made element by element: every storage, holes, lengths around the one that is copied inline, every kind of start. Then arrays that are not plain, and an array of the greatest length.
class Rec { constructor(public id: number) {} }

function numbersFrom(a: number[], start: number): number[] { return a.slice(start); }
function valuesFrom(a: unknown[], start: number): unknown[] { return a.slice(start); }
function numbersBetween(a: number[], start: number, end?: number): number[] { return a.slice(start, end); }
function valuesBetween(a: unknown[], start: number, end: number | undefined): unknown[] { return a.slice(start, end); }

function show(v: unknown): string { return v instanceof Rec ? "#" + v.id : v === undefined ? "undefined" : v === null ? "null" : typeof v === "string" ? "'" + v + "'" : Object.is(v, -0) ? "-0" : String(v); }
function list(a: readonly unknown[]): string { let t = a.length + "["; for (let k = 0; k < a.length; k++) t += (k in a ? show(a[k]) : "_") + ","; return t + "]"; }
function clamp(index: number, n: number): number { const relative = index !== index ? 0 : Math.trunc(index); return relative < 0 ? Math.max(n + relative, 0) : Math.min(relative, n); }
function expected(a: readonly unknown[], start: number, end: number | undefined): string {
  const n = a.length, from = clamp(start, n), to = end === undefined ? n : clamp(end, n), count = Math.max(to - from, 0);
  let t = count + "[";
  for (let k = 0; k < count; k++) t += (from + k in a ? show(a[from + k]) : "_") + ",";
  return t + "]";
}
let checks = 0, bad = 0;
function check(name: string, got: readonly unknown[], want: string): void {
  const text = list(got);
  checks++;
  if (text !== want && bad++ < 12) console.log("DIFFERS: " + name + "\n  got  " + text + "\n  want " + want);
}
function build<T>(n: number, element: (k: number) => T, holes: number): T[] {
  const a: T[] = [];
  for (let k = 0; k < n; k++) a.push(element(k));
  if (holes) for (let k = 1; k < n; k += holes) delete a[k];
  return a;
}
const mixedAt = (k: number): unknown => (k % 4 === 0 ? undefined : k % 4 === 1 ? null : k % 4 === 2 ? -0 : new Rec(k));

for (const n of [0, 1, 2, 3, 8, 63, 64, 65, 66, 130, 1000]) {
  const numberArrays: [string, number[]][] = [["int32s", build(n, k => k * 3, 0)], ["doubles", build(n, k => k + 0.5, 0)], ["doubles with holes", build(n, k => k + 0.5, 3)]];
  const valueArrays: [string, unknown[]][] = [["strings", build(n, k => "t" + k, 0)], ["mixed values", build(n, mixedAt, 0)], ["strings with holes", build(n, k => "t" + k, 2)], ["int32s", build(n, k => k * 3, 0)]];
  for (const start of [0, 1, 2, n >> 1, n - 65, n - 64, n - 1, n, n + 1, -1, -2, -64, -65, -n, -n - 1, 0.5, -1.5, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31) - 1, 2 ** 32, 2 ** 53]) {
    const at = " " + n + " from " + start;
    for (const [kind, a] of numberArrays) {
      check(kind + at, numbersFrom(a, start), expected(a, start, undefined));
      check(kind + at + " without an end", numbersBetween(a, start), expected(a, start, undefined));
      check(kind + at + " to undefined", numbersBetween(a, start, undefined), expected(a, start, undefined));
      check(kind + at + " to -1", numbersBetween(a, start, -1), expected(a, start, -1));
      check(kind + at + " to 2 ** 32", numbersBetween(a, start, 2 ** 32), expected(a, start, 2 ** 32));
    }
    for (const [kind, a] of valueArrays) {
      check(kind + at, valuesFrom(a, start), expected(a, start, undefined));
      check(kind + at + " to undefined", valuesBetween(a, start, undefined), expected(a, start, undefined));
      check(kind + at + " to " + (n - 1), valuesBetween(a, start, n - 1), expected(a, start, n - 1));
    }
  }
}
console.log(checks + " checks, " + bad + " bad");

function report(name: string, run: () => string): void { let text: string; try { text = run(); } catch (error) { text = error instanceof TypeError ? "TypeError" : "threw " + String(error); } console.log(name + ": " + text); }
class Numbers extends Array<number> {}
report("constants", () => list(numbersFrom([1, 2, 3, 4], 1)) + " " + list(numbersBetween([1.5, 2.5, 3.5], 1, undefined)));
report("frozen", () => list(numbersFrom(Object.freeze([1, 2, 3]) as number[], 1)));
report("subclass", () => { const a = new Numbers(); a.push(1, 2, 3); const part = numbersFrom(a, 1); return (part instanceof Numbers) + " " + list(part); });
report("inherited in a hole", () => { const a = [1, , 3] as number[]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: 77 }); return list(numbersFrom(a, 0)) + " " + list(numbersBetween(a, 1)); });
report("sparse", () => { const a = [1, 2]; a[100000] = 3; return list(numbersFrom(a, 99998)) + " " + list(numbersBetween(a, -2, undefined)); });
report("greatest length", () => {
  const a: number[] = [];
  a.length = 4294967295;
  a[4294967290] = 3;
  a[4294967294] = 7;
  return [list(numbersFrom(a, 4294967289)), list(numbersFrom(a, -3)), list(numbersBetween(a, 4294967293)), list(numbersBetween(a, -6, undefined)), list(numbersFrom(a, 4294967295)), list(numbersFrom(a, 4294967296))].join(" ");
});
console.log(bad ? "slices without an end: FAILED" : "slices without an end: PASS");
