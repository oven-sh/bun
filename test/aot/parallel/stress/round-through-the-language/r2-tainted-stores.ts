// A round through the language: tainted stores. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
type P = { x: number; y: string };
const bad: any[] = ["str", { k: 1 }, null, undefined, 10n, [7], true];
let modNum: number = 0;
function setMod(n: number): void { modNum = n; }
function readMod(): string { const v = modNum; return typeof v + (v + 1); }
function counter() { let c: number = 0; return { set(n: number): void { c = n; }, get(): string { return typeof c + (c * 2); } }; }
class Box { v: number = 0; set(n: number): void { this.v = n; } get(): string { return typeof this.v + (this.v + 1); } }
class Stat { static s: number = 0; static set(n: number): void { Stat.s = n; } static get(): string { return typeof Stat.s + (Stat.s + 1); } }
class Priv { #v: number = 0; set(n: number): void { this.#v = n; } get(): string { return typeof this.#v + (this.#v + 1); } }
const xs: number[] = [];
function push(n: number): void { xs.push(n); }
function last(): string { const v = xs[xs.length - 1]; return typeof v + (v + 1); }
const table = new Map<string, number>();
function put(n: number): void { table.set("k", n); }
function got(): string { const v = table.get("k")!; return typeof v + (v + 1); }
function mk(n: number): () => string { return () => typeof n + (n + 1); }
function inner(m: number): string { return typeof m + (m * 2); }
function outer(n: number): string { return inner(n); }
function mkP(x: number): P { return { x, y: "s" }; }
function readP(p: P): string { return typeof p.x + (p.x + 1) + p.y; }
function rejoin(n: number, p: P): string { const a = n + 1; console.log("side"); return typeof a + a + (p.x + 1); }
function loop(n: number): string { let t = 0; for (let i = 0; i < n; i++) t += i; return typeof t + t; }
function tries(n: number): string { let r: number = 0; try { r = n; if (n > 1) throw n; } catch (e) { r = e as number; } finally { r = r; } return typeof r + r; }
function switches(n: number): string { switch (n) { case 1: return "one"; case 2: return "two"; default: return typeof n; } }
function ternary(n: number, m: number): string { const r = n > m ? n : m; return typeof r + r; }
function compound(n: number): string { let r = 1; r += n; r *= 2; return typeof r + r; }
function spreadIn(n: number): string { const o = { ...{ a: n } }; const [b] = [n]; return typeof o.a + typeof b; }
function templ(n: number): string { return `${n}|${n + 1}`; }
function nested(n: number): string { const f = (k: number): number => k + n; const r = f(1); return typeof r + r; }
const c = counter(), box = new Box(), priv = new Priv();
const setters: [string, (v: any) => void, () => string][] = [
  ["mod", setMod, readMod], ["captured", c.set, c.get], ["field", (v) => box.set(v), () => box.get()], ["static", Stat.set, Stat.get],
  ["private", (v) => priv.set(v), () => priv.get()], ["array", push, last], ["map", put, got],
];
for (const [name, set, get] of setters) {
  show(name + "-ok", () => { set(1); return get(); });
  for (let i = 0; i < bad.length; i++) show(name + "#" + i, () => { set(bad[i]); return get(); });
  show(name + "-again", () => { set(2); return get(); });
}
const callers: [string, (v: any) => unknown][] = [
  ["closure", (v) => mk(v)()], ["passed-on", outer], ["literal", (v) => readP(mkP(v))], ["rejoin", (v) => rejoin(v, { x: 1, y: "y" })],
  ["rejoin-p", (v) => rejoin(1, v)], ["loop", loop], ["tries", tries], ["switches", switches], ["ternary", (v) => ternary(v, 1)], ["compound", compound],
  ["spread", spreadIn], ["template", templ], ["nested", nested],
];
for (const [name, call] of callers) {
  show(name + "-ok", () => call(3));
  for (let i = 0; i < bad.length; i++) show(name + "#" + i, () => call(bad[i]));
}
show("inner-typed", () => inner(4));
show("readP-typed", () => readP({ x: 5, y: "z" }));
