// A rest in an assignment pattern copies as a rest in a declaration does.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; b: number }
class C implements S { a = 1; get b(): number { return 2 } }
const heir = (): S => new C();
row("the rest", () => { let a: number; let rest: { b: number }; ({ a, ...rest } = heir()); return a + " " + typeof rest.b });
