// A copy of an instance, typed as the class: a method read as a value is undefined; called, it throws as in plain JavaScript.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
class C { a = 1; m(): number { return this.a } }
row("read as a value", () => { const c: C = Object.assign({}, new C()); const m = c.m; return typeof m });
row("called", () => { const c: C = Object.assign({}, new C()); return c.m() });
row("of a base class", () => { class D extends C { d = 2 } const d: D = Object.assign({}, new D()); const m = d.m; return typeof m + " " + d.d });
