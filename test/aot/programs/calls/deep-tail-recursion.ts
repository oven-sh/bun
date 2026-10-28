// Recursion a million calls deep through tail calls: direct calls, methods, function values and continuation passing all finish without overflowing the stack. One row differs from plain Bun, with or without the types: a call in a catch block without `finally` is in tail position by ECMAScript, and plain Bun makes no tail call there.
declare const console: any;
function attempt(name: string, f: () => unknown) { try { console.log(name + ": " + f()); } catch (e: any) { console.log(name + ": " + e.constructor.name); } }
const N = 1_000_000;
// Direct calls
function self(n: number, acc: number): number { if (n === 0) return acc; return self(n - 1, acc + 1); }
function selfCond(n: number, acc: number): number { return n === 0 ? acc : selfCond(n - 1, acc + 1); }
function selfAnd(n: number): boolean { return n === 0 || selfAnd(n - 1); }
function even(n: number): boolean { if (n === 0) return true; return odd(n - 1); }
function odd(n: number): boolean { if (n === 0) return false; return even(n - 1); }
function three1(n: number): string { return n === 0 ? "one" : three2(n - 1); }
function three2(n: number): string { return n === 0 ? "two" : three3(n - 1); }
function three3(n: number): string { return n === 0 ? "three" : three1(n - 1); }
const arrow = (n: number): number => (n === 0 ? 0 : arrow(n - 1));
function strings(n: number, s: string): string { return n === 0 ? s : strings(n - 1, n % 100000 === 0 ? s + "x" : s); }
function doubles(n: number, d: number): number { return n === 0 ? d : doubles(n - 1, d + 0.5); }
function objects(n: number, o: { k: number }): { k: number } { return n === 0 ? o : objects(n - 1, o); }
function fresh(n: number, o: { k: number }): number { return n === 0 ? o.k : fresh(n - 1, { k: o.k + 1 }); }
function voids(n: number): void { if (n === 0) return; return voids(n - 1); }
function eight(n: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number): number { return n === 0 ? a + b + c + d + e + f + g : eight(n - 1, g, a, b, c, d, e, f); }
function twelve(n: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number): number { return n === 0 ? a + 2 * b + 3 * c + d + e + f + g + h + i + j + 11 * k : twelve(n - 1, k, a, b, c, d, e, f, g, h, i, j); }
function few(n: number): number { return n === 0 ? 0 : many(n - 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11); }
function many(n: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number): number { return n === 0 ? a + k : few(n - 1); }
function defaults(n: number, a: number = n * 2): number { return n === 0 ? a : defaults(n - 1); }
function rest(n: number, ...more: number[]): number { return n === 0 ? more.length : rest(n - 1, 1, 2); }
function nested(n: number): number { let count = 0; function inner(k: number): number { count++; return k === 0 ? count : inner(k - 1); } return inner(n); }
function closures(n: number, f: () => number): number { return n === 0 ? f() : closures(n - 1, () => n); }
function asNumber(n: number): number { return n === 0 ? 0.5 : asInteger(n - 1); }
function asInteger(n: number): number { return n === 0 ? 1 : asNumber(n - 1); }
function inCatch(n: number): number { try { if (n > 0) throw 1; return 0; } catch { return inCatch(n - 1); } }
function inFinally(n: number): number { try { } finally { if (n > 0) return inFinally(n - 1); } return 0; }
function afterTry(n: number): number { try { marks++; } catch { } return n === 0 ? 0 : afterTry(n - 1); }
function inLoop(n: number): number { while (true) { if (n === 0) return 0; return inLoop(n - 1); } }
function inSwitch(n: number): number { switch (n) { case 0: return 0; default: return inSwitch(n - 1); } }
let marks = 0;
attempt("self", () => self(N, 0)); attempt("self, ?:", () => selfCond(N, 0)); attempt("self, ||", () => selfAnd(N)); attempt("two", () => even(N)); attempt("three", () => three1(N));
attempt("an arrow", () => arrow(N)); attempt("strings", () => strings(N, "")); attempt("doubles", () => doubles(N, 0)); attempt("objects", () => objects(N, { k: 1 }).k); attempt("fresh objects", () => fresh(N, { k: 0 }));
attempt("void", () => voids(N)); attempt("eight arguments", () => eight(N, 1, 2, 3, 4, 5, 6, 7)); attempt("twelve arguments", () => twelve(N, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)); attempt("one and twelve", () => few(N));
attempt("defaults", () => defaults(N)); attempt("rest", () => rest(N)); attempt("an inner function", () => nested(N)); attempt("closures", () => closures(N, () => 0));
attempt("number and integer", () => asNumber(N));
attempt("in a catch", () => inCatch(N)); attempt("in a finally", () => inFinally(N)); attempt("after a try", () => afterTry(N)); attempt("in a loop", () => inLoop(N)); attempt("in a switch", () => inSwitch(N));
// Methods
class C { k = 1; walk(n: number): number { if (n === 0) return this.k; return this.walk(n - 1); } static s(n: number): number { return n === 0 ? 0 : C.s(n - 1); } static t(n: number): number { return n === 0 ? 0 : this.t(n - 1); } #p(n: number): number { return n === 0 ? 0 : this.#p(n - 1); } p(n: number): number { return this.#p(n); } get g(): number { return self(N, 0); } ping(n: number): number { return n === 0 ? 1 : this.pong(n - 1); } pong(n: number): number { return n === 0 ? 2 : this.ping(n - 1); } }
class D extends C { walk(n: number): number { return n === 0 ? -1 : super.walk(n - 1); } }
const literal = { k: 4, m(n: number): number { return n === 0 ? this.k : this.m(n - 1); } };
interface Walker { step(n: number): number }
class W1 implements Walker { constructor(public next: Walker | null) { } step(n: number): number { return n === 0 ? 1 : this.next!.step(n - 1); } }
class W2 implements Walker { constructor(public next: Walker | null) { } step(n: number): number { return n === 0 ? 2 : this.next!.step(n - 1); } }
attempt("a method", () => new C().walk(N)); attempt("a static method, by the class", () => C.s(N)); attempt("a static method, by this", () => C.t(N)); attempt("a private method", () => new C().p(N)); attempt("a getter", () => new C().g);
attempt("two methods", () => new C().ping(N)); attempt("super", () => new D().walk(N)); attempt("a literal's method", () => literal.m(N));
attempt("by an interface", () => { const a = new W1(null), b = new W2(a); a.next = b; return a.step(N); });
// Function values
const byValue = (f: (n: number, g: any) => number, n: number): number => f(n, f);
const loop = (n: number, g: any): number => (n === 0 ? 0 : g(n - 1, g));
function typedValue(n: number, f: (n: number, f: any) => number): number { return n === 0 ? 0 : f(n - 1, f); }
function anyValue(n: any, f: any): any { return n === 0 ? 0 : f(n - 1, f); }
function stringValue(n: number, f: any): string { return n === 0 ? "s" : f(n - 1, f); }
function trampoline(n: number, table: Array<(n: number, t: any) => number>): number { return n === 0 ? 0 : table[n % 2](n - 1, table); }
function viaCall(n: number): number { return n === 0 ? 0 : viaCall.call(undefined, n - 1); }
function viaApply(n: number): number { return n === 0 ? 0 : viaApply.apply(undefined, [n - 1]); }
function viaSpread(n: number): number { const a: [number] = [n - 1]; return n === 0 ? 0 : viaSpread(...a); }
function viaOptional(n: number, f?: (n: number, f: any) => number): number | undefined { return n === 0 ? 0 : f?.(n - 1, f); }
function tag(s: TemplateStringsArray, n: number): number { return n === 0 ? 0 : tag`${n - 1}`; }
attempt("by value", () => byValue(loop, N)); attempt("by value, typed", () => typedValue(N, typedValue)); attempt("by value, any", () => anyValue(N, anyValue)); attempt("by value, a string", () => stringValue(N, stringValue));
attempt("out of a table", () => trampoline(N, [trampoline, trampoline])); attempt("call", () => viaCall(N)); attempt("apply", () => viaApply(N)); attempt("spread", () => viaSpread(N)); attempt("?.()", () => viaOptional(N, viaOptional as any));
attempt("a tagged template", () => tag`${N}`);
// Continuation passing
type K = (v: number) => number;
function sum(n: number, k: K): number { return n === 0 ? k(0) : sum(n - 1, v => k(v + 1)); }
attempt("continuations", () => sum(100_000, v => v));
console.log(marks);
