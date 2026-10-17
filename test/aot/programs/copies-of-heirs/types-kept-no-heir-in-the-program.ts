// Nothing in this program leaves a member to a prototype: what a spread, Object.assign and a rest pattern copy keeps its type, and so do the reads.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface S { a: number; b: number }
const make = (a: number): S => ({ a, b: a + 1 });
const copy = (s: S): S => ({ ...s });
const assigned = (s: S): S => Object.assign({}, s);
const rest = ({ a, ...others }: S) => others;
row("spread", () => { const c = copy(make(1)); return c.a + c.b });
row("Object.assign", () => { const c = assigned(make(2)); return c.a + c.b });
row("rest", () => rest(make(3)).b + 1);
