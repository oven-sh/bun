// Integer arithmetic on values that pass through functions, so that nothing is folded at build time; -0 is distinguished from 0 with `Object.is`.
declare const console: { log(...v: unknown[]): void };
const show = (x: number): string => Object.is(x, -0) ? "-0" : String(x);
const values: number[] = [0, -0, 1, -1, 2, 7, 8, 9, -7, -8, -9, 0.5, -0.5, 1.5, 7.999999, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967297, 9007199254740991, 9007199254740992, 9007199254740994,
  -9007199254740992, 9223372036854775808, -9223372036854775808, 18446744073709551616, 1e21, -1e21, 1.7976931348623157e308, 5e-324, Infinity, -Infinity, NaN, 123456789012, -123456789012, 3000000000.75, -3000000000.75];
function and7(i: number): number { return i & 7 }
function or0(i: number): number { return i | 0 }
function xor(i: number, j: number): number { return i ^ j }
function shl(i: number, j: number): number { return i << j }
function shr(i: number, j: number): number { return i >> j }
function ushr(i: number, j: number): number { return i >>> j }
function not(i: number): number { return ~i }
function imul(i: number, j: number): number { return Math.imul(i, j) }
function trunc0(i: number): number { return Math.trunc(i) | 0 }
function round0(i: number): number { return Math.round(i) | 0 }
function mod8(i: number): number { return i % 8 }
function mod1(i: number): number { return i % 1 }
function mod10(i: number): number { return i % 10 }
function mod2eq(i: number): boolean { return i % 2 === 0 }
function mod(i: number, j: number): number { return i % j }
function mod60(i: number): number { return Math.floor(i / 60) % 60 }
function modLengths(s: string, t: string): number { return s.length % t.length }
function modLength8(s: string): number { return s.length % 8 }
function modIndex(a: number[], s: string): number | undefined { return a[s.length % a.length] }
function modLengthBy(s: string, j: number): number { return s.length % j }
function modByLength(i: number, s: string): number { return i % s.length }
// Each stays a separate function in the image, even if it is also inlined at its calls: the test measures its size.
;(globalThis as any).kept = [and7, or0, xor, shl, shr, ushr, not, imul, trunc0, round0, mod8, mod1, mod10, mod2eq, mod, mod60, modLengths, modLength8, modIndex, modLengthBy, modByLength];
for (const v of values) console.log(show(v), show(and7(v)), show(or0(v)), show(not(v)), show(trunc0(v)), show(round0(v)), show(mod8(v)), show(mod1(v)), show(mod10(v)), mod2eq(v), show(mod60(v)));
let lines = 0, sum = "";
for (const v of values) { for (const w of values) { sum += [xor(v, w), shl(v, w), shr(v, w), ushr(v, w), imul(v, w), mod(v, w)].map(show).join(",") + ";"; } console.log(sum); sum = ""; lines++; }
const texts = ["", "a", "ab", "abcdefg", "abcdefgh", "abcdefghi", "abcdefghijklmnopqrstuvwxyz"];
for (const s of texts) { for (const t of texts) sum += show(modLengths(s, t)) + ","; sum += show(modLength8(s)) + ";" + String(modIndex([10, 20, 30], s)) + ";" + String(modIndex([], s)) + ";"; for (const v of values) sum += show(modLengthBy(s, v)) + "," + show(modByLength(v, s)) + ","; console.log(sum); sum = ""; }
console.log(lines);
