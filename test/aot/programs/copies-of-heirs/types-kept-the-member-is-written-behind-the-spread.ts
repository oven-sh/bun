// The copy is given `b` behind the spread, whatever its source held: it lacks nothing.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface S { a: number; b: number }
class C implements S { a = 1; get b(): number { return 2 } }
const heir = (): S => new C();
const copy = (s: S): S => ({ ...s, b: 5 });
row("the heir", () => heir().b);
row("spread", () => { const c = copy(heir()); return c.a + c.b });
