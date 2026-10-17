// A spread of an object that inherits a required member lacks that member, and reading it yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface S { a: number; b: number }
row("a spread of an heir", () => { const base = { b: 2 }; const o: S = Object.assign(Object.create(base), { a: 1 }); const c: S = { ...o }; return c.a + " " + c.b });
