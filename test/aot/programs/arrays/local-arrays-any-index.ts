// Arrays that are made, read at an index that is only known when the program runs, and dropped: rest parameters of functions that are inlined, and literals. Every index: inside, the length, beyond, negative, the largest array index and what lies behind it. Two reads in one expression, reads in nested loops, behind a condition, under try, in a loop that leaves early. Elements that are numbers, undefined, NaN, -0, records, strings, mixed. And the neighbours that must stay as they are: an index that is no whole number, a store, a push, an array that is handed on.
declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public id: number) {} }
function show(v: unknown): string { return v instanceof Rec ? "#" + v.id : v === undefined ? "undefined" : v === null ? "null" : typeof v === "string" ? "'" + v + "'" : Object.is(v, -0) ? "-0" : String(v); }
function sum(...xs: number[]): number { let s = 0; for (let k = 0; k < xs.length; k++) s += xs[k]; return s; }
function sumDown(...xs: number[]): number { let s = 0; for (let k = xs.length - 1; k >= 0; k--) s += xs[k]; return s; }
function pairs(...xs: number[]): number { let s = 0; for (let i = 0; i < xs.length; i++) for (let j = 0; j < xs.length; j++) s += xs[i] * xs[j] + xs[j]; return s; }
function atInt(i: number, ...xs: number[]): number | undefined { return xs[i | 0]; }
function atUint(i: number, ...xs: number[]): number | undefined { return xs[i >>> 0]; }
function atNumber(i: number, ...xs: number[]): number | undefined { return xs[i]; }
function neighbours(i: number, ...xs: number[]): string { const k = i | 0; return show(xs[k]) + show(xs[k + 1]) + show(xs[k - 1]) + show(xs[k]); }
function firstBig(least: number, ...xs: number[]): number { for (let k = 0; k < xs.length; k++) { if (xs[k] >= least) return k; } return -1; }
function guarded(i: number, ...rs: Rec[]): string { try { return "#" + rs[i | 0].id; } catch (e) { return "caught " + (e instanceof TypeError); } }
function maybe(flag: boolean, i: number, ...xs: number[]): number | undefined { if (flag) return xs[i | 0]; return xs.length; }
function recAt(i: number, ...rs: Rec[]): Rec | undefined { return rs[i | 0]; }
function textAt(i: number, ...ts: string[]): string | undefined { return ts[i | 0]; }
function anyAt(i: number, ...vs: unknown[]): unknown { return vs[i | 0]; }
function literalAt(i: number, a: number, b: number): number | undefined { const both = [a, b]; return both[i | 0]; }
function emptyAt(i: number): unknown { const none: unknown[] = []; return none[i | 0]; }
function storedThenRead(i: number, ...xs: number[]): number | undefined { xs[1] = 40; return xs[i | 0]; }
function pushedThenRead(i: number, ...xs: number[]): number | undefined { xs.push(50); return xs[i | 0]; }
let seen: number[] = [];
function handedOn(i: number, ...xs: number[]): number | undefined { seen = xs; return xs[i | 0]; }
function four(i: number, a: number): number | undefined { const few = [a, 2.5, a + 1, 4.5]; return few[i | 0]; }
function five(i: number, a: number): number | undefined { const some = [a, 2.5, a + 1, 4.5, 5.5]; return some[i | 0]; }
function nine(i: number): number | undefined { const many = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]; return many[i | 0]; }
const values: number[] = []; for (let i = 0; i < 8; i++) values.push(i + 0.5);
const indexes = [0, 1, 2, 3, 4, -1, -2, 2147483647, -2147483648, 4294967294, 4294967295, 4294967296, 9007199254740991, 0.5, 1.5, -0.5, NaN, Infinity, -Infinity, -0];
const r1 = new Rec(1), r2 = new Rec(2), r3 = new Rec(3);
const out: string[] = [];
for (let round = 0; round < 3; round++) {
  let t = 0;
  for (let i = 0; i < values.length; i++) { const v = values[i]; t += sum(v, v + 1, v + 2) + sumDown(v, 1, v) + pairs(v, 2) + sum(v) + sum() + firstBig(3, v, v + 1, v + 2, v + 3); }
  out.push("sums " + t + " " + show(sum(values[8], 1)) + show(sum(NaN, 1)) + show(sum(-0)) + show(Object.is(sum(-0, -0), -0)) + show(sumDown(values[9], values[0])));
  let line = "";
  for (const i of indexes) line += show(atInt(i, 1.5, 2.5, 3.5)) + "," + show(atUint(i, 1.5, 2.5, 3.5)) + "," + show(atNumber(i, 1.5, 2.5, 3.5)) + ";";
  out.push("every index " + line);
  line = ""; for (const i of indexes) line += neighbours(i, 1.5, values[9], -0, NaN) + ";"; out.push("neighbours " + line);
  line = ""; for (const i of indexes) line += guarded(i, r1, r2) + "," + show(recAt(i, r1, r2, r3)) + "," + show(textAt(i, "a", "b")) + "," + show(anyAt(i, 1, "a", null, undefined, r3, 0.5, true)) + ";"; out.push("others " + line);
  line = ""; for (const i of indexes) line += show(maybe(true, i, 1.5, 2.5)) + show(maybe(false, i, 1.5, 2.5)) + "," + show(literalAt(i, 7.5, values[round])) + "," + show(emptyAt(i)) + "," + show(atInt(i)) + "," + show(nine(i)) + "," + show(four(i, values[round])) + "," + show(five(i, values[round])) + ";"; out.push("literals " + line);
  line = ""; for (const i of indexes) { line += show(storedThenRead(i, 1.5, 2.5, 3.5)) + "," + show(pushedThenRead(i, 1.5, 2.5)) + "," + show(handedOn(i, 1.5, 2.5)) + show(seen.length) + ";"; } out.push("what must stay " + line);
}
for (const text of out) console.log(text);
