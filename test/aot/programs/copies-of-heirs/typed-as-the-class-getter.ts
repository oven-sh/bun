// A copy of an instance, typed as the class itself: Object.assign onto an empty literal has the type of the class, and none of what the class's prototype provides: reading the getter yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
class C { a = 1; get b(): number { return 2 } }
row("the getter", () => { const c: C = Object.assign({}, new C()); return c.a + " " + c.b });
row("added to", () => { const c: C = Object.assign({}, new C()); return c.b + 1 });
