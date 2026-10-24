// Rarely taken slow paths that call into C++ while many values are live in registers.
declare const console: any;
const log: any[] = [];
interface R { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; s: string; next: R | undefined }
function make(k: number): R { return { a: k + 0.5, b: k + 1, c: k + 2.25, d: k + 3, e: k + 4.75, f: k + 5, g: k + 6.125, h: k + 7, s: "r" + k, next: undefined }; }

// ToInt32 of a double that fcvtzs cannot take: no instance, a double in, an integer out.
function toInt32(r: R, x: number, y: number): number {
    const a = r.a, b = r.b, c = r.c, d = r.d, e = r.e, f = r.f, g = r.g, h = r.h;
    const i1 = (b | 0) + 1, i2 = (d | 0) + 2, i3 = (f | 0) + 3, i4 = (h | 0) + 4;
    const p = x | 0;
    const q = y >>> 0;
    const t = (x * y) & 0xffff;
    return a + b + c + d + e + f + g + h + i1 * 3 + i2 * 5 + i3 * 7 + i4 * 11 + p + q + t + (a * c - e * g);
}
// A receiver that is null or undefined: a throw out of a function without a frame. The handler is in the caller.
function nilReceiver(r: R, u: R): number {
    const a = r.a, b = r.b, c = r.c, d = r.d, e = r.e, f = r.f, g = r.g, h = r.h;
    const v = u.a + u.b * 2 + u.c * 3;
    return a + b + c + d + e + f + g + h + v + (a * b - c * d) + (e * f - g * h);
}
// A number that is not kept in place (not an int32 where one is expected): a plain operation with the instance.
function elsewhere(r: R, u: R): number {
    const a = r.a, b = r.b, c = r.c, d = r.d, e = r.e, f = r.f;
    const v = (u.b & 255) + (u.d & 255) + (u.f & 255) + (u.h & 255);
    return a + b + c + d + e + f + v + (a * b - c * d) + e * f;
}
// Only integers are live across the cold calls: the stubs that save no FP register.
function integersOnly(r: R, u: R, w: R): number {
    const a = r.b | 0, b = r.d | 0, c = r.f | 0, d = r.h | 0;
    const v = (u.b & 255) + (u.d & 255);
    const x = (w.f & 255) + (w.h & 255);
    return ((a ^ b) + (c ^ d) + v * 13 + x * 17 + a * 3 + b * 5 + c * 7 + d * 11) | 0;
}
// ToNumber of a value that is not a number: returns a double, may throw, may run code.
function toNumber(r: R, x: any, y: any): number {
    const a = r.a, b = r.b, c = r.c, d = r.d, e = r.e, f = r.f, g = r.g, h = r.h;
    const v = x * 2 + y * 3;
    return a + b + c + d + e + f + g + h + v + (a * c - e * g) + (b * d - f * h);
}
// Remainder and power.
function arithmetic(r: R, x: number, y: number): number {
    const a = r.a, b = r.b, c = r.c, d = r.d, e = r.e, f = r.f, g = r.g, h = r.h;
    const v = x % y + x ** y;
    return a + b + c + d + e + f + g + h + v + (a * c - e * g) + (b * d - f * h);
}
function attempt(name: string, f: () => any) { try { log.push(name + ": " + f()); } catch (e: any) { log.push(name + " threw " + e.constructor.name); } }
const r = make(1), u = make(10);
for (const [x, y] of [[1, 2], [1e300, -1e300], [NaN, Infinity], [-Infinity, 4294967296.5], [2147483648, -2147483649], [9007199254740993, 1e21], [-0, 0.5]]) {
    attempt("toInt32 " + x + " " + y, () => toInt32(r, x, y));
    attempt("arithmetic " + x + " " + y, () => arithmetic(r, x, y));
}
attempt("nilReceiver", () => nilReceiver(r, u));
attempt("nilReceiver undefined", () => nilReceiver(r, undefined as any));
attempt("nilReceiver null first", () => nilReceiver(null as any, u));
const big = make(3); big.b = 1e10; big.d = 2.5; big.f = -3e9; big.h = NaN;
attempt("elsewhere", () => elsewhere(r, u));
attempt("elsewhere big", () => elsewhere(r, big));
attempt("integersOnly", () => integersOnly(r, u, r));
attempt("integersOnly big", () => integersOnly(r, big, u));
attempt("integersOnly big twice", () => integersOnly(big, big, big));
attempt("integersOnly nil", () => integersOnly(r, u, undefined as any));
let ran = 0;
for (const [x, y] of [[1, 2], ["3", "4.5"], [undefined, null], [true, "x"], [{ valueOf() { ran++; return 7; } }, [8]], [Symbol("s"), 1], [1n, 2], [{ valueOf() { throw new RangeError("no"); } }, 1]] as [any, any][])
    attempt("toNumber " + typeof x + " " + typeof y, () => toNumber(r, x, y));
log.push(ran);
// Again and again, so that a register that is lost once in a while shows.
let s = 0;
for (let i = 0; i < 20000; i++) { s += toInt32(r, i & 1 ? 1e300 : i, i & 2 ? NaN : -i) + elsewhere(r, i & 4 ? big : u) + toNumber(r, i & 8 ? "5" : 5, i) + arithmetic(r, i, 2) + integersOnly(r, i & 16 ? big : u, i & 32 ? big : r); }
log.push(s);
// The function without a frame is in the stack trace.
function names(e: any) { return String(e.stack).split("\n").map(line => /(nilReceiver|outer)/.exec(line)?.[1]).filter(Boolean).join(">"); }
function outer() { const v = nilReceiver(r, undefined as any); return v + 1; }
try { outer(); } catch (e: any) { log.push(names(e)); }
console.log(log.join("\n"));
export {};
