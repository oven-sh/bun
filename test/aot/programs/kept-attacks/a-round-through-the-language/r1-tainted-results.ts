// A round through the language: tainted results. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
type P = { x: number; y: string };
function same(n: number): number { return n; }
function plus(n: number): number { return n + 1; }
function text(s: string): string { return s; }
function obj(p: P): P { return p; }
function pick(p: P): number { return p.x; }
function either(c: boolean, n: number): number { return c ? n : 0; }
function viaLocal(n: number): number { const m = n; let k = m; return k; }
function viaCall(n: number): number { return same(n); }
function viaField(n: number): number { const o = { v: n }; return o.v; }
function viaArray(n: number): number { const a = [n]; return a[0]; }
function viaClosure(n: number): number { const g = () => n; return g(); }
const A: any = { same, plus, text, obj, pick, either, viaLocal, viaCall, viaField, viaArray, viaClosure };
show("same", () => { const r = A.same("s"); return typeof r + r; });
show("same-math", () => A.same("7") * 2);
show("same-obj", () => { const r = A.same({ k: 1 }); return typeof r + JSON.stringify(r); });
show("plus", () => { const r = A.plus("s"); return typeof r + r; });
show("text", () => { const r = A.text(42); return typeof r + (r + 1); });
show("text-len", () => A.text([1, 2, 3]).length);
show("obj", () => { const r = A.obj("str"); return typeof r + r.length; });
show("obj-x", () => A.obj({ x: "X", y: 1 }).x + 1);
show("pick", () => { const r = A.pick({ x: "px" }); return typeof r + r; });
show("either", () => { const r = A.either(true, "e"); return typeof r + r; });
show("either-c", () => { const r = A.either("", 5); return typeof r + r; });
show("viaLocal", () => { const r = A.viaLocal("l"); return typeof r + r; });
show("viaCall", () => { const r = A.viaCall("c"); return typeof r + r; });
show("viaField", () => { const r = A.viaField("f"); return typeof r + r; });
show("viaArray", () => { const r = A.viaArray("a"); return typeof r + r; });
show("viaClosure", () => { const r = A.viaClosure("cl"); return typeof r + r; });
// The same functions also have well-typed direct callers that rely on the result.
function typedUser(n: number): string { const a = same(n) + plus(n) + viaCall(n); return "t" + (a * 2); }
show("typedUser", () => typedUser(1));
show("typedUser-bad", () => (typedUser as any)("1"));
function mixedUser(v: any): string { const a = same(v); const b = plus(v); return typeof a + typeof b + (a + b); }
show("mixedUser", () => mixedUser(2));
show("mixedUser-bad", () => mixedUser("2"));
show("mixedUser-bad2", () => mixedUser({ valueOf() { return 3; } }));
function storesResult(v: any): string { const box: { n: number } = { n: same(v) }; return typeof box.n + box.n; }
show("storesResult", () => storesResult(4));
show("storesResult-bad", () => storesResult("four"));
let kept: number = 0;
function keepsResult(v: any): string { kept = same(v); return typeof kept + kept; }
show("keepsResult", () => keepsResult(5));
show("keepsResult-bad", () => keepsResult("five"));
show("kept-after", () => typeof kept + (kept + 1));
class Acc { total = 0; add(n: number): number { this.total += n; return this.total; } get(): number { return this.total; } }
const acc = new Acc();
show("acc", () => acc.add(1) + acc.get());
show("acc-bad", () => { const r = (acc as any).add("x"); return typeof r + r; });
show("acc-after", () => { const r = acc.get(); return typeof r + r + (acc.add(1)); });
