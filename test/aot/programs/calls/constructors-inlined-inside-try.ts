// Constructors that are inlined inside `try` blocks: exceptions and partially initialized objects behave as written.
declare const console: any;
const log: any[] = [];
const seen: any[] = [];
interface A { x: number; y: number }
function A(this: A, x: number, y: number) { this.x = x; this.y = y; }
interface B { x: number; y: number }
function B(this: B, x: number, y: number) { this.x = x; this.y = y; if (x < 0) throw new RangeError("negative"); }
interface C { x: number; y: number }
function C(this: C, x: number, y: number) { this.x = x; seen.push(this); this.y = y; if (y < 0) throw new RangeError("after handing out"); }
interface S { x: number; z: number }
function S(this: S, x: number, z: number) { this.x = x; this.z = z; }
Object.defineProperty((S as any).prototype, "z", { set(v: number) { if (v < 0) throw new RangeError("setter"); log.push("setter " + v); }, get() { return 77; }, configurable: true });
const AC = A as any as new (x: number, y: number) => A, BC = B as any as new (x: number, y: number) => B, CC = C as any as new (x: number, y: number) => C, SC = S as any as new (x: number, z: number) => S;
function show(o: any) { return JSON.stringify(o) + " keys " + Object.keys(o).join(); }
function a(x: number): string { try { return show(new AC(x, 1)); } catch (e: any) { return "caught " + e.message; } }
function b(x: number): string { try { return show(new BC(x, 1)); } catch (e: any) { return "caught " + e.message; } }
function c(y: number): string { try { return show(new CC(1, y)); } catch (e: any) { return "caught " + e.message + " " + show(seen[seen.length - 1]); } }
function s(z: number): string { try { const o = new SC(1, z); return show(o) + " z " + o.z; } catch (e: any) { return "caught " + e.message; } }
function nested(x: number): string { try { try { return show(new BC(x, 2)); } finally { log.push("finally " + x); } } catch (e: any) { return "outer caught " + e.message; } }
function two(x: number): string { try { const p = new AC(x, 1), q = new BC(x, 2); return show(p) + show(q); } catch (e: any) { return "caught " + e.message; } }
async function asyncB(x: number): Promise<string> { const o = new BC(x, 3); await undefined; return show(o); }
async function asyncS(z: number): Promise<string> { await undefined; const o = new SC(2, z); return show(o); }
for (const v of [1, -1]) { log.push("a " + a(v)); log.push("b " + b(v)); log.push("c " + c(v)); log.push("s " + s(v)); log.push("nested " + nested(v)); log.push("two " + two(v)); }
let n = 0; for (let i = 0; i < 20000; i++) { const r = b(i & 1 ? -i : i); n += r.length; } log.push(n);
Promise.allSettled([asyncB(1), asyncB(-1), asyncS(1), asyncS(-1)]).then(r => { for (const x of r) log.push(x.status + " " + (x.status === "fulfilled" ? x.value : (x.reason as any).message)); console.log(log.join("\n")); });
export {};
