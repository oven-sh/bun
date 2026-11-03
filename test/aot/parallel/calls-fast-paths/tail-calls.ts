// Tail calls: a recursion a million deep in tail position finishes, and a caller that makes a tail call has no frame in stack traces, as in plain Bun.
declare const console: any;
function names(e: any): string { return String(e.stack).split("\n").map((l: string) => /(?:at )?(t_[a-z]+)/.exec(l)).filter(Boolean).map((m: any) => m[1]).join(); }
function count(n: number, a: number): number { return n === 0 ? a : count(n - 1, a + 1); }
function even(n: number): boolean { return n === 0 ? true : odd(n - 1); }
function odd(n: number): boolean { return n === 0 ? false : even(n - 1); }
function withIf(n: number, s: string): string { if (n === 0) return s; if (n & 1) return withIf(n - 1, s); return withIf(n - 1, s); }
function logical(n: number): boolean { return n === 0 || logical(n - 1); }
function comma(n: number): number { return n === 0 ? 0 : (void 0, comma(n - 1)); }
function objects(n: number, o: { v: number }): { v: number } { return n === 0 ? o : objects(n - 1, o); }
const arrow = (n: number, a: number): number => n === 0 ? a : arrow(n - 1, a + 2);
class K { constructor(public k: number) {} walk(n: number): number { return n === 0 ? this.k : this.walk(n - 1); } static down(n: number): number { return n === 0 ? 5 : K.down(n - 1); } }
function doubles(n: number, x: number): number { return n === 0 ? x : doubles(n - 1, x + 0.5); }
function eight(n: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number): number { return n === 0 ? a + b + c + d + e + f + g : eight(n - 1, b, c, d, e, f, g, a); }
const N = 1000000;
function attempt(f: () => unknown): string { try { return String(f()); } catch (e: any) { return e.constructor.name; } }
console.log([() => count(N, 0), () => even(N), () => odd(N), () => withIf(N, "s"), () => logical(N), () => comma(N), () => objects(N, { v: 3 }).v, () => arrow(N, 0), () => new K(9).walk(N), () => K.down(N), () => doubles(N, 0), () => eight(N, 1, 2, 3, 4, 5, 6, 7)].map(attempt).join(" "));
function t_fail(): number { throw new Error("x"); }
function t_tail(): number { return t_fail(); }
function t_kept(): number { return t_tail() + 1; }
function t_outer(): number { return t_kept(); }
function t_top(): string { try { return "" + t_outer(); } catch (e) { return names(e); } }
console.log(t_top());
// A getter is no call: whoever reads the property keeps its frame. The getter's own tail call gives up the getter's.
class G { get t_getter(): number { return t_fail(); } t_method(): number { return t_fail(); } }
function t_reads(g: G): number { return g.t_getter; }
function t_invokes(g: G): number { return g.t_method(); }
function t_rethrows(): number { try { return t_fail(); } catch (e) { throw e; } }
function t_casts(): number { return t_fail() as number; }
function t_either(c: boolean): number { return c ? t_fail() : 0; }
function t_second(c: boolean): boolean { return c && t_fail() > 0; }
for (const f of [() => t_reads(new G()) + 1, () => t_invokes(new G()) + 1, () => t_rethrows() + 1, () => t_casts() + 1, () => t_either(true) + 1, () => (t_second(true) ? 1 : 0) + 1]) { try { f(); } catch (e) { console.log(names(e)); } }
let t = 0;
for (let i = 0; i < 300; i++) t = (t + count(20000, i) + (even(20001) ? 1 : 0) + new K(i).walk(20000)) | 0;
console.log(t);
export {};
