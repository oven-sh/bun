// A copy of an instance, typed as the class and then seen through an interface that the class implements with a getter: reading the member yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; b: number }
class C implements S { a = 1; get b(): number { return 2 } }
const read = (s: S): number => s.b + 1;
row("through the interface", () => { const c: C = Object.assign({}, new C()); return read(c) });
row("an instance", () => read(new C()));
