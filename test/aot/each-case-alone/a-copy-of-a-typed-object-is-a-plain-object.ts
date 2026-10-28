// A copy of an object of a declared type, made where nothing is declared, is a plain object: it takes any value under any name, and a typed place that gets it later answers as plain Bun does or refuses loudly.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
const show = (v: unknown) => typeof v === "string" ? v : v === undefined || typeof v === "function" || typeof v === "symbol" ? typeof v : JSON.stringify(v);
function t(name: string, f: () => unknown) { let r; try { r = show(f()); } catch (e) { r = "threw " + (e as Error).name; } console.log(name, r); }
const never = process.argv.length > 99;
const unseen = eval;
const through = (v: unknown): any => { (globalThis as any).handed = v; return unseen("handed"); };
const copy = (p: any): any => ({ ...p });
type P = { x: number; y: number };
class C { x = 1; y = 2; sum() { return this.x + this.y; } }
const sum = (p: P) => p.x + p.y;
t("the copy takes a text under a name declared as a number", () => { const s: P = { x: 1, y: 2 }; const c = copy(through(s)); c.x = "text"; return [c.x, typeof c.x, c.x + 1, s.x + 1]; });
t("the copy loses a declared name, gets another, is redefined, is frozen, changes its prototype", () => { const s: P = { x: 1, y: 2 }; const a = copy(through(s)), b = copy(s), c = copy(s), d = copy(s), e = copy(s); delete a.x; b.q = 1; Object.defineProperty(c, "x", { get() { return "got"; } }); Object.freeze(d); Object.setPrototypeOf(e, null); return [a, b, c.x, Object.isFrozen(d), Object.getPrototypeOf(e), s, sum(s)]; });
t("the unchanged copy arrives at a typed place", () => { const s: P = { x: 1, y: 2 }; return [sum(copy(through(s)) as P), sum({ ...s }), sum({ ...s, x: 5 })]; });
t("the copy without a declared name arrives at a typed place", () => { const s: P = { x: 1, y: 2 }; const c = copy(through(s)); delete c.x; return sum(c as P); });
t("the copy with an accessor arrives at a typed place", () => { const s: P = { x: 1, y: 2 }; const c = copy(through(s)); Object.defineProperty(c, "x", { get() { return 40; } }); return sum(c as P); });
t("the rest of a typed object", () => { const s: P = { x: 1, y: 2 }; const { x, ...rest } = through(s); rest.x = "again"; return [x, Object.keys(rest).join(), rest.x, s]; });
t("the copy of an instance is no instance", () => { const s = new C(); const c = copy(through(s)); c.x = "text"; return [c instanceof C, typeof c.sum, c.x, s.sum(), Object.getPrototypeOf(c) === Object.prototype]; });
t("the copy of an instance arrives where the class is declared", () => { const s = new C(); const c = copy(through(s)); const read = (o: C) => o.x + o.y; return [read(c as C), read(s)]; });
t("the copy of an instance is asked for a method where the class is declared", () => { const s = new C(); const c = copy(through(s)); const call = (o: C) => o.sum(); return [call(s), call(c as C)]; });
t("a copy beside a typed object that nobody else saw", () => { const known: P = { x: 1, y: 2 }; const s: P = { x: 3, y: 4 }; const c = copy(through(s)); c.y = 0.5; return [sum(known), sum(c as P), sum(never ? known : (c as P))]; });
