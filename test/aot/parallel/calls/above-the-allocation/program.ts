declare const console: any;
const log: any[] = [];
interface Q { a: number; b: number; c?: any }
function Q(this: Q, a: number) { this.a = a; }
const QC = Q as any as new (a: number) => Q;
const first = (Q as any).prototype; first.describe = function () { return "first"; };
const second = { describe() { return "second"; } };
let g = 0;
function bump(): number { log.push("bump " + g); return ++g; }
function mayThrow(a: number): number { g += 100; if (a & 1) throw new RangeError("odd"); return a; }
function swap(to: any): number { (Q as any).prototype = to; return 1; }
function show(q: any) { return JSON.stringify(q) + " keys " + Object.keys(q).join() + " " + (typeof q.describe === "function" ? q.describe() : "no describe"); }
function calls(a: number): string { const q = new QC(a); const x = bump(); q.b = x; const y = bump(); q.c = y; return show(q) + " g " + g; }
function throwsBetween(a: number): string { const before = g; try { const q = new QC(a); const x = mayThrow(a); q.b = x; return show(q) + " " + (g - before); } catch (e: any) { return "caught " + e.constructor.name + " " + (g - before); } }
function prototypeReplaced(a: number): string { const q = new QC(a); const x = swap(second); q.b = x; const r = new QC(a + 1); const y = swap(first); r.b = y; return show(q) + " | " + show(r); }
function readsAround(a: number): string { const before = g; const q = new QC(a); const during = g; q.b = during; g++; const after = g; q.c = after; return show(q) + " " + (before === during) + " " + (after - before); }
function eachOther(a: number): string { const q = new QC(a); const r = new QC(a + 1); q.b = 1; r.b = 2; q.c = r; r.c = 5; return JSON.stringify(q) + " " + (q.c === r); }
function wrongType(a: number, v: any): string { const before = g; try { const q = new QC(a); q.b = v; const x = bump(); q.c = x; return show(q) + " " + (g - before); } catch (e: any) { return "caught " + e.constructor.name + " " + (g - before); } }
// A store into the fresh object that is not a plain store: the name is found on the prototype, with a setter, which changes what is read next. The read after such a store must not be moved before it.
interface S { a: number; x: number; y: number }
function S(this: S, a: number) { this.a = a; }
Object.defineProperty((S as any).prototype, "x", { set(v: number) { g = v; log.push("setter " + v); }, get() { return -1; }, configurable: true });
const SC = S as any as new (a: number) => S;
function setterBetween(a: number): string { const s = new SC(a); s.x = a + 1000; const seen = g; s.y = seen; return JSON.stringify(s) + " seen " + seen + " x " + s.x; }
const holder = { n: 0 };
interface U { a: number; x: number; y: number }
function U(this: U, a: number) { this.a = a; }
Object.defineProperty((U as any).prototype, "x", { set(v: number) { holder.n = v; }, configurable: true });
const UC = U as any as new (a: number) => U;
function setterBetweenField(a: number): string { const u = new UC(a); u.x = a + 2000; const seen = holder.n; u.y = seen; return JSON.stringify(u) + " seen " + seen; }
function attempt(name: string, f: () => any) { try { log.push(name + ": " + f()); } catch (e: any) { log.push(name + " threw " + e.constructor.name); } }
for (let round = 0; round < 2; round++) {
    attempt("calls", () => calls(1)); attempt("throwsBetween even", () => throwsBetween(2)); attempt("throwsBetween odd", () => throwsBetween(3)); attempt("prototypeReplaced", () => prototypeReplaced(4));
    attempt("readsAround", () => readsAround(5)); attempt("eachOther", () => eachOther(6)); attempt("wrongType, right", () => wrongType(7, 8));
    // Not under `attempt`: where a handler watches, the store ends its block, and nothing is taken across.
    log.push("setterBetween: " + setterBetween(9 + round)); log.push("setterBetweenField: " + setterBetweenField(11 + round));
}
console.log(log.join("\n"));
export {};
