// Calls that are not in tail position keep their stack frame, so deep recursion overflows; the few here that are in tail position finish. Both as in plain Bun.
declare const console: any;
function attempt(n: string, f: () => unknown): void { try { console.log(n + ": " + JSON.stringify(f())); } catch (e: any) { console.log(n + ": throws " + e.constructor.name); } }
const N = 1000000;
function plusOne(n: number): number { return n === 0 ? 0 : 1 + plusOne(n - 1); }
function inTry(n: number): number { try { return n === 0 ? 0 : inTry(n - 1); } catch (e) { throw e; } }
function inTryFinally(n: number): number { try { return n === 0 ? 0 : inTryFinally(n - 1); } finally { marks++; } }
function inCatch(n: number): number { try { if (n > 0) throw 1; return 0; } catch { return inCatch(n - 1); } }
function inFinally(n: number): number { try { } finally { if (n > 0) return inFinally(n - 1); } return 0; }
function afterTry(n: number): number { try { marks++; } catch { } return n === 0 ? 0 : afterTry(n - 1); }
function assigned(n: number): number { if (n === 0) return 0; const r = assigned(n - 1); marks += r; return r; }
function converted(n: number): string { return n === 0 ? "0" : "" + converted(n - 1); }
function voided(n: number): void { if (n > 0) voided(n - 1); }
let marks = 0;
attempt("1 + f()", () => plusOne(N)); attempt("in a try", () => inTry(N)); attempt("in a try with finally", () => inTryFinally(N)); attempt("in a catch", () => inCatch(2000)); attempt("in a finally", () => inFinally(2000));
attempt("behind a try", () => afterTry(N)); attempt("assigned first", () => assigned(N)); attempt("converted", () => converted(N).length); attempt("no return", () => voided(N));
// The handler of the CALLER's caller takes what the callee throws.
function thrower(k: number): number { if (k === 3) throw new RangeError("three"); return k; }
function passesOn(k: number): number { return thrower(k); }
function catches(k: number): string { try { return "got " + passesOn(k); } catch (e: any) { return "caught " + e.message; } }
attempt("the handler above", () => [catches(1), catches(3)]);
// Constructors: what is returned is looked at.
const Plain: any = function (this: any, o: any) { this.v = 1; return make(o); };
function make(o: any): any { return o; }
attempt("constructors", () => [new Plain(undefined).v, new Plain(5).v, new Plain({ z: 5 }).z]);
// Coroutines.
async function later(n: number): Promise<number> { return n === 0 ? 0 : later(n - 1); }
function* gen(n: number): Generator<number, number> { yield n; return tailOf(n); }
function tailOf(n: number): number { return n * 2; }
console.log("async: " + await later(1000)); attempt("generator", () => { const g = gen(4); return [g.next(), g.next(), g.next()]; });
// Getters, setters, default parameters, `this`, more arguments than registers.
const o = { k: 4, get g(): number { return twice(this.k); }, m(n: number): number { return n === 0 ? this.k : this.m(n - 1); } };
function twice(n: number): number { return n * 2; }
function defaults(n: number, a: number = n * 2): number { return n === 0 ? a : defaults(n - 1); }
function many(n: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return n === 0 ? a + b + c + d + e + f + g + h + i + j : many(n - 1, j, a, b, c, d, e, f, g, h, i); }
attempt("a getter", () => o.g); attempt("a literal's method", () => o.m(1000)); attempt("defaults", () => defaults(1000)); attempt("eleven arguments", () => many(1000, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
// What differs in how it is kept: an integer returned as a number, a boolean as anything.
function asNumber(n: number): number { return n === 0 ? 0.5 : small(n); }
function small(n: number): number { return n & 7; }
function asAnything(n: number): unknown { return n === 0 ? "s" : isOdd(n); }
function isOdd(n: number): boolean { return (n & 1) === 1; }
attempt("kept otherwise", () => [asNumber(0), asNumber(13), asAnything(0), asAnything(3)]);
// HERE ONLY THE FORMS THAT `bun run` LEAVES AS THEY ARE WRITTEN: its transpiler turns `const r = f(x); return r;` (and `let`) INTO `return f(x);` (f.toString() shows it).
function throughVar(n: number): number { if (n === 0) return 0; var r; r = throughVar(n - 1); return r; }
function throughParameter(n: number, r?: number): number { if (n === 0) return 0; r = throughParameter(n - 1); return r; }
let outside = 0;
function throughOutside(n: number): number { if (n === 0) return 0; outside = throughOutside(n - 1); return outside; }
attempt("through a var", () => throughVar(N));
attempt("through a parameter", () => throughParameter(N));
attempt("through a variable outside", () => throughOutside(N));
console.log(marks > 0);
export {};
