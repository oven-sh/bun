// a.splice(start, D, ..) with D written as 0, 1, 2 or 3 and 0 to 9 inserted elements, against the same edit made element by element: int32s, doubles, strings and mixed values, holes, full and spare capacity, short and long tails, every kind of start. Then arrays whose storage cannot be edited in place.
class Rec { constructor(public id: number) {} }

function spliceNumbers0(a: number[], s: number, x: number[]): number[] {
  switch (x.length) {
    case 0: return a.splice(s, 0);
    case 1: return a.splice(s, 0, x[0]);
    case 2: return a.splice(s, 0, x[0], x[1]);
    case 3: return a.splice(s, 0, x[0], x[1], x[2]);
    case 4: return a.splice(s, 0, x[0], x[1], x[2], x[3]);
    case 5: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4]);
    case 6: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4], x[5]);
    case 7: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    case 8: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
    default: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8]);
  }
}
function spliceNumbers1(a: number[], s: number, x: number[]): number[] {
  switch (x.length) {
    case 0: return a.splice(s, 1);
    case 1: return a.splice(s, 1, x[0]);
    case 2: return a.splice(s, 1, x[0], x[1]);
    case 3: return a.splice(s, 1, x[0], x[1], x[2]);
    case 4: return a.splice(s, 1, x[0], x[1], x[2], x[3]);
    case 5: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4]);
    case 6: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4], x[5]);
    case 7: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    case 8: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
    default: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8]);
  }
}
function spliceNumbers2(a: number[], s: number, x: number[]): number[] {
  switch (x.length) {
    case 0: return a.splice(s, 2);
    case 1: return a.splice(s, 2, x[0]);
    case 2: return a.splice(s, 2, x[0], x[1]);
    case 3: return a.splice(s, 2, x[0], x[1], x[2]);
    case 4: return a.splice(s, 2, x[0], x[1], x[2], x[3]);
    case 5: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4]);
    case 6: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4], x[5]);
    case 7: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    case 8: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
    default: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8]);
  }
}
function spliceNumbers3(a: number[], s: number, x: number[]): number[] {
  switch (x.length) {
    case 0: return a.splice(s, 3);
    case 1: return a.splice(s, 3, x[0]);
    case 2: return a.splice(s, 3, x[0], x[1]);
    case 3: return a.splice(s, 3, x[0], x[1], x[2]);
    case 4: return a.splice(s, 3, x[0], x[1], x[2], x[3]);
    case 5: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4]);
    case 6: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4], x[5]);
    case 7: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    case 8: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
    default: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8]);
  }
}
function spliceValues0(a: unknown[], s: number, x: unknown[]): unknown[] {
  switch (x.length) {
    case 0: return a.splice(s, 0);
    case 1: return a.splice(s, 0, x[0]);
    case 2: return a.splice(s, 0, x[0], x[1]);
    case 3: return a.splice(s, 0, x[0], x[1], x[2]);
    case 4: return a.splice(s, 0, x[0], x[1], x[2], x[3]);
    case 5: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4]);
    case 6: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4], x[5]);
    case 7: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    case 8: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
    default: return a.splice(s, 0, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8]);
  }
}
function spliceValues1(a: unknown[], s: number, x: unknown[]): unknown[] {
  switch (x.length) {
    case 0: return a.splice(s, 1);
    case 1: return a.splice(s, 1, x[0]);
    case 2: return a.splice(s, 1, x[0], x[1]);
    case 3: return a.splice(s, 1, x[0], x[1], x[2]);
    case 4: return a.splice(s, 1, x[0], x[1], x[2], x[3]);
    case 5: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4]);
    case 6: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4], x[5]);
    case 7: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    case 8: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
    default: return a.splice(s, 1, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8]);
  }
}
function spliceValues2(a: unknown[], s: number, x: unknown[]): unknown[] {
  switch (x.length) {
    case 0: return a.splice(s, 2);
    case 1: return a.splice(s, 2, x[0]);
    case 2: return a.splice(s, 2, x[0], x[1]);
    case 3: return a.splice(s, 2, x[0], x[1], x[2]);
    case 4: return a.splice(s, 2, x[0], x[1], x[2], x[3]);
    case 5: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4]);
    case 6: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4], x[5]);
    case 7: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    case 8: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
    default: return a.splice(s, 2, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8]);
  }
}
function spliceValues3(a: unknown[], s: number, x: unknown[]): unknown[] {
  switch (x.length) {
    case 0: return a.splice(s, 3);
    case 1: return a.splice(s, 3, x[0]);
    case 2: return a.splice(s, 3, x[0], x[1]);
    case 3: return a.splice(s, 3, x[0], x[1], x[2]);
    case 4: return a.splice(s, 3, x[0], x[1], x[2], x[3]);
    case 5: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4]);
    case 6: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4], x[5]);
    case 7: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    case 8: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]);
    default: return a.splice(s, 3, x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8]);
  }
}
type Splice<T> = (a: T[], s: number, x: T[]) => T[];
const numberSplices: Splice<number>[] = [spliceNumbers0, spliceNumbers1, spliceNumbers2, spliceNumbers3];
const valueSplices: Splice<unknown>[] = [spliceValues0, spliceValues1, spliceValues2, spliceValues3];

function show(v: unknown): string { return v instanceof Rec ? "#" + v.id : v === undefined ? "undefined" : v === null ? "null" : typeof v === "string" ? "'" + v + "'" : Object.is(v, -0) ? "-0" : String(v); }
function showAt(a: readonly unknown[], k: number): string { return (k in a ? show(a[k]) : "_") + ","; }
function list(a: readonly unknown[]): string { let t = a.length + "["; for (let k = 0; k < a.length; k++) t += showAt(a, k); return t + "]"; }
function expected(a: readonly unknown[], start: number, deleteCount: number, items: readonly unknown[]): string {
  const n = a.length, relative = start !== start ? 0 : Math.trunc(start);
  const from = relative < 0 ? Math.max(n + relative, 0) : Math.min(relative, n), count = Math.min(deleteCount, n - from);
  let removed = count + "[", edited = n - count + items.length + "[";
  for (let k = 0; k < count; k++) removed += showAt(a, from + k);
  for (let k = 0; k < from; k++) edited += showAt(a, k);
  for (const item of items) edited += show(item) + ",";
  for (let k = from + count; k < n; k++) edited += showAt(a, k);
  return removed + "] " + edited + "]";
}
let checks = 0, bad = 0;
function check<T>(name: string, splice: Splice<T>, a: T[], start: number, deleteCount: number, items: T[]): void {
  const want = expected(a, start, deleteCount, items), removed = splice(a, start, items), got = list(removed) + " " + list(a);
  checks++;
  if (got !== want && bad++ < 12) console.log("DIFFERS: " + name + "\n  got  " + got + "\n  want " + want);
}
function build<T>(n: number, element: (k: number) => T, hasSpareCapacity: boolean, holes: number): T[] {
  const a: T[] = [];
  for (let k = 0; k < n; k++) a.push(element(k));
  const result = hasSpareCapacity ? a : a.slice();
  if (holes) for (let k = 1; k < n; k += holes) delete result[k];
  return result;
}
const int32At = (k: number) => k * 3, doubleAt = (k: number) => k + 0.5, stringAt = (k: number): unknown => "t" + k;
const mixedAt = (k: number): unknown => (k % 4 === 0 ? undefined : k % 4 === 1 ? null : k % 4 === 2 ? -0 : new Rec(k));

for (const n of [0, 1, 2, 3, 5, 8, 33, 34, 35, 36, 70]) {
  for (const start of [0, 1, 2, n >> 1, n - 2, n - 1, n, n + 1, -1, -2, -n, -n - 1, 0.5, -1.5, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31) - 1, 2 ** 32 + 1]) {
    for (let deleteCount = 0; deleteCount <= 3; deleteCount++) {
      for (let inserted = 0; inserted <= 9; inserted++) {
        const int32s: number[] = [], fractions: number[] = [], oddNumbers: number[] = [], values: unknown[] = [];
        for (let k = 0; k < inserted; k++) { int32s.push(100 + k); fractions.push(100.25 + k); oddNumbers.push(k === inserted - 1 ? NaN : k ? 100.25 + k : -0); values.push(k % 3 === 0 ? "x" + k : k % 3 === 1 ? new Rec(100 + k) : k); }
        for (const hasSpareCapacity of [false, true]) {
          const at = " n=" + n + " start=" + start + " delete=" + deleteCount + " insert=" + inserted + (hasSpareCapacity ? " spare" : " full");
          const numbers = numberSplices[deleteCount], anything = valueSplices[deleteCount];
          check("int32s into int32s" + at, numbers, build(n, int32At, hasSpareCapacity, 0), start, deleteCount, int32s);
          check("fractions into int32s" + at, numbers, build(n, int32At, hasSpareCapacity, 0), start, deleteCount, fractions);
          check("int32s into doubles" + at, numbers, build(n, doubleAt, hasSpareCapacity, 0), start, deleteCount, int32s);
          check("fractions into doubles" + at, numbers, build(n, doubleAt, hasSpareCapacity, 0), start, deleteCount, fractions);
          check("NaN and -0 into doubles" + at, numbers, build(n, doubleAt, hasSpareCapacity, 0), start, deleteCount, oddNumbers);
          check("int32s into doubles with holes" + at, numbers, build(n, doubleAt, hasSpareCapacity, 3), start, deleteCount, int32s);
          check("values into strings" + at, anything, build(n, stringAt, hasSpareCapacity, 0), start, deleteCount, values);
          check("values into mixed values" + at, anything, build(n, mixedAt, hasSpareCapacity, 0), start, deleteCount, values);
          check("values into strings with holes" + at, anything, build(n, stringAt, hasSpareCapacity, 2), start, deleteCount, values);
          check("values into int32s" + at, anything, build<unknown>(n, int32At, hasSpareCapacity, 0), start, deleteCount, values);
          check("values into doubles" + at, anything, build<unknown>(n, doubleAt, hasSpareCapacity, 0), start, deleteCount, values);
        }
      }
    }
  }
}
console.log(checks + " checks, " + bad + " bad");

function report(name: string, run: () => string): void { let text: string; try { text = run(); } catch (error) { text = error instanceof TypeError ? "TypeError" : "threw " + String(error); } console.log(name + ": " + text); }
function edit(a: number[], inserted: number): string {
  const items: number[] = [];
  for (let k = 0; k < inserted; k++) items.push(50 + k);
  let text: string;
  try { text = list(spliceNumbers1(a, 1, items)); } catch (error) { text = error instanceof TypeError ? "TypeError" : "threw " + String(error); }
  return text + " " + list(a);
}
class Numbers extends Array<number> {}
for (const inserted of [0, 1, 2, 3, 8, 9]) {
  const label = " with " + inserted + " inserted";
  report("constants" + label, () => edit([1, 2, 3, 4], inserted) + " " + edit([1.5, 2.5, 3.5, 4.5], inserted));
  report("frozen" + label, () => edit(Object.freeze([1, 2, 3, 4]) as number[], inserted));
  report("sealed" + label, () => edit(Object.seal([1, 2, 3, 4]), inserted));
  report("not extensible" + label, () => edit(Object.preventExtensions([1, 2, 3, 4]), inserted));
  report("length is read-only" + label, () => edit(Object.defineProperty([1, 2, 3, 4], "length", { writable: false }), inserted));
  report("sparse" + label, () => { const a = [1, 2, 3]; a[100000] = 4; const removed = spliceNumbers1(a, 1, [7, 8, 9].slice(0, Math.min(inserted, 3))); return list(removed) + " " + a.length + " " + list(a.slice(0, 6)); });
  report("subclass" + label, () => { const a = new Numbers(); a.push(1, 2, 3, 4); const removed = spliceNumbers1(a, 1, [7, 8, 9].slice(0, Math.min(inserted, 3))); return (removed instanceof Numbers) + " " + list(removed) + " " + list(a); });
  report("inherited in a hole" + label, () => { const a = [1, , 3, 4] as number[]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: 77 }); return edit(a, inserted); });
  report("named property" + label, () => { const a = [1, 2, 3, 4]; (a as unknown as { tag: string }).tag = "kept"; return edit(a, inserted) + " " + (a as unknown as { tag: string }).tag; });
}
console.log(bad ? "splices with a literal delete count: FAILED" : "splices with a literal delete count: PASS");
