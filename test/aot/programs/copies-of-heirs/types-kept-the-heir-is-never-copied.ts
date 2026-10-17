// An S may have `b` from its prototype, but nothing copies an S: the reads of another type that is copied keep their type.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface S { a: number; b: number }
interface P { x: number; y: number }
const base = { b: 2 };
const heir = (): S => Object.assign(Object.create(base), { a: 1 });
const point = (x: number): P => ({ x, y: x + 1 });
const copy = (p: P): P => ({ ...p });
row("the heir", () => heir().a + heir().b);
row("spread", () => { const c = copy(point(1)); return c.x + c.y });
