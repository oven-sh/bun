// `== null`, `!= null`, `??`, `?.` on values of every kind, as parameters of no type, of union types and read from objects and arrays: undefined and null answer one way; false, true, 0,
// -0, NaN, "", 0n, symbols, objects, functions and document.all's absence the other.
const lines: string[] = [];
const values: unknown[] = [undefined, null, false, true, 0, -0, 1, -1, 2, 6, 7, 10, 0.5, NaN, Infinity, 2 ** 31, 2 ** 53, "", "a", 0n, 10n, Symbol.iterator, {}, [], () => 1, new Date(0), /x/, new Map()];
function isNil(v: unknown): boolean { return v == null; }
function isNotNil(v: unknown): boolean { return v != null; }
function orElse(v: unknown): unknown { return v ?? "else"; }
function lengthOf(v: any): unknown { return v?.length; }
function ofUnion(v: string | number | null | undefined): string { return v == null ? "nil" : typeof v; }
function ofObject(v: { a: number } | null | undefined): number { return v == null ? -1 : v.a; }
function ofBoolean(v: boolean | null): string { return v == null ? "nil" : v ? "yes" : "no"; }
function both(a: unknown, b: unknown, c: unknown, d: unknown, e: unknown, f: unknown, g: unknown): number { let n = 0; if (a == null) n |= 1; if (b == null) n |= 2; if (c == null) n |= 4; if (d == null) n |= 8; if (e == null) n |= 16; if (f == null) n |= 32; if (g == null) n |= 64; return n + (isNil(a) ? 1000 : 0); }
class Holder { constructor(public any: unknown, public text: string | null, public next: Holder | undefined) {} }
function ofFields(h: Holder): string { return (h.any == null ? "n" : "v") + (h.text == null ? "n" : "v") + (h.next == null ? "n" : "v") + (h.next?.any == null ? "n" : "v"); }
function name(v: unknown): string { return typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? Object.prototype.toString.call(v) : typeof v === "function" ? "function" : String(v); }
for (let round = 0; round < 3; round++) for (const v of values) { const line = name(v) + ": " + isNil(v) + " " + isNotNil(v) + " " + name(orElse(v)) + " " + name(lengthOf(v)); if (round === 2) lines.push(line); }
for (const v of ["", "x", 0, 5, NaN, null, undefined]) lines.push("union " + name(v) + ": " + ofUnion(v));
for (const v of [{ a: 3 }, null, undefined]) lines.push("object: " + ofObject(v));
for (const v of [true, false, null]) lines.push("boolean: " + ofBoolean(v));
let sum = 0; for (let i = 0; i < values.length; i++) sum += both(values[i], values[(i + 1) % values.length], values[(i + 2) % values.length], values[(i + 3) % values.length], values[(i + 5) % values.length], values[(i + 7) % values.length], values[(i + 11) % values.length]) * (i + 1);
lines.push("both " + sum);
const last = new Holder(null, null, undefined);
for (const h of [last, new Holder(0, "", last), new Holder(false, "t", new Holder(1, null, undefined)), new Holder(undefined, null, new Holder(undefined, "x", last))]) lines.push("fields " + ofFields(h));
console.log(lines.join("\n"));
