// A class has `b` as a getter, but its instances are no S (they lack `a`): a copy of an S cannot be a copy of one of them, and the reads keep their type.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface S { a: number; b: number }
class Other { c = 1; get b(): number { return 2 } }
const make = (a: number): S => ({ a, b: a + 1 });
const copy = (s: S): S => ({ ...s });
row("the class", () => new Other().b + new Other().c);
row("spread", () => { const c = copy(make(1)); return c.a + c.b });
