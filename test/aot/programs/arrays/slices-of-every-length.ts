// a.slice(i, j) and a.slice() against a copy made element by element: every length from 0 to 40 and some around the sizes where storage changes its class, every pair of bounds, arrays of doubles, of int32s, of records, of strings, with holes, with undefined and null. What is copied is a copy: a store to it leaves the source alone.
declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public id: number) {} }
function sliceDoubles(a: number[], i: number, j: number): number[] { return a.slice(i, j); }
function sliceRecs(a: Rec[], i: number, j: number): Rec[] { return a.slice(i, j); }
function sliceTexts(a: string[], i: number, j: number): string[] { return a.slice(i, j); }
function sliceUnknown(a: unknown[], i: number, j: number): unknown[] { return a.slice(i, j); }
function copyDoubles(a: number[]): number[] { return a.slice(); }
function copyRecs(a: Rec[]): Rec[] { return a.slice(); }
function copyUnknown(a: unknown[]): unknown[] { return a.slice(); }
function show(v: unknown): string { return v instanceof Rec ? "#" + v.id : v === undefined ? "undefined" : v === null ? "null" : typeof v === "string" ? "'" + v + "'" : Object.is(v, -0) ? "-0" : String(v); }
function list(a: readonly unknown[]): string { let t = a.length + "["; for (let k = 0; k < a.length; k++) t += (k in a ? show(a[k]) : "_") + ","; return t + "]"; }
function expected(a: readonly unknown[], i: number, j: number): string {
  const n = a.length, from = i < 0 ? Math.max(n + i, 0) : Math.min(i, n), to = j < 0 ? Math.max(n + j, 0) : Math.min(j, n), count = Math.max(to - from, 0);
  let t = count + "["; for (let k = 0; k < count; k++) t += (from + k in a ? show(a[from + k]) : "_") + ","; return t + "]";
}
let checks = 0, bad = 0;
function check(name: string, got: readonly unknown[], want: string): void { checks++; const text = list(got); if (text !== want) { if (bad++ < 12) console.log("DIFFERS: " + name + "\n  got  " + text.slice(0, 300) + "\n  want " + want.slice(0, 300)); } }
const lengths: number[] = []; for (let n = 0; n <= 40; n++) lengths.push(n); lengths.push(61, 62, 63, 64, 65, 66, 126, 127, 128, 129, 500, 1007, 1008, 1009, 1010, 1300);
for (const n of lengths) {
  const doubles: number[] = [], int32s: number[] = [], recs: Rec[] = [], texts: string[] = [], mixed: unknown[] = [], holey: unknown[] = [], holeyDoubles: number[] = [];
  for (let k = 0; k < n; k++) { doubles.push(k + 0.5); int32s.push(k * 3); recs.push(new Rec(k)); texts.push("t" + k); mixed.push(k % 4 === 0 ? undefined : k % 4 === 1 ? null : k % 4 === 2 ? -0 : new Rec(k)); holey.push(new Rec(k)); holeyDoubles.push(k + 0.25); }
  for (let k = 1; k < n; k += 3) { delete holey[k]; delete holeyDoubles[k]; }
  const bounds: number[] = n <= 12 ? [] : [0, 1, 2, 3, n >> 1, (n >> 1) + 1, n - 3, n - 2, n - 1, n, n + 1, -1, -2, -3, -n, -n - 1];
  if (n <= 12) for (let b = -n - 1; b <= n + 1; b++) bounds.push(b);
  for (const i of bounds) for (const j of bounds) {
    const at = " " + n + " (" + i + ", " + j + ")";
    check("doubles" + at, sliceDoubles(doubles, i, j), expected(doubles, i, j)); check("int32s" + at, sliceDoubles(int32s, i, j), expected(int32s, i, j)); check("records" + at, sliceRecs(recs, i, j), expected(recs, i, j));
    check("strings" + at, sliceTexts(texts, i, j), expected(texts, i, j)); check("mixed" + at, sliceUnknown(mixed, i, j), expected(mixed, i, j)); check("holes" + at, sliceUnknown(holey, i, j), expected(holey, i, j)); check("holes among doubles" + at, sliceDoubles(holeyDoubles, i, j), expected(holeyDoubles, i, j));
  }
  check("all doubles " + n, copyDoubles(doubles), expected(doubles, 0, n)); check("all int32s " + n, copyDoubles(int32s), expected(int32s, 0, n)); check("all records " + n, copyRecs(recs), expected(recs, 0, n)); check("all mixed " + n, copyUnknown(mixed), expected(mixed, 0, n)); check("all with holes " + n, copyUnknown(holey), expected(holey, 0, n));
  if (n) {
    const before = list(doubles), copy = copyDoubles(doubles); copy[0] = -1; copy.push(7.5); copy.push(8.5); check("a copy is a copy " + n, doubles, before); check("what was pushed to a copy " + n, copy.slice(n), "2[7.5,8.5,]");
    const part = sliceRecs(recs, 0, n); for (let k = 0; k < 5; k++) part.push(new Rec(900 + k)); check("a slice grows " + n, part.slice(n - 1), "6[#" + (n - 1) + ",#900,#901,#902,#903,#904,]");
  }
}
console.log(checks + " checks, " + bad + " bad");
console.log(bad ? "slices of every length: FAILED" : "slices of every length: PASS");
