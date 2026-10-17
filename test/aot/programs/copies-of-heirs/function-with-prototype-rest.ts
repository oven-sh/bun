// A copy holds only what its source itself holds and shows: what `new` of a function with an assigned prototype made, copied by a rest pattern, lacks `b`, and reading it yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
interface W { b: number }
interface S extends W { a: number }
const base = { b: 2 };
function F(this: S) { this.a = 1 }
F.prototype.b = 2;
const heir = (): S => new (F as unknown as new () => S)();
const copy = (s: S) => { const { a, ...rest } = s; return rest };
row("the heir", () => heir().b);
row("read", () => copy(heir()).b);
row("added to", () => copy(heir()).b + 1);
row("held by a constant", () => { const c = copy(heir()); const n: number = c.b; return typeof n });
row("in", () => "b" in copy(heir()));
row("destructured", () => { const { b } = copy(heir()); return typeof b });
row("by a string", () => typeof copy(heir())["b"]);
row("an argument", () => { const take = (n: number): string => typeof n; return take(copy(heir()).b) });
row("a pattern in a parameter", () => { const take = ({ b }: { b: number }): string => typeof b; return take(copy(heir())) });
row("copied again", () => { const again = { ...copy(heir()) }; return typeof again.b });
row("keys", () => Object.keys(copy(heir())).join());
row("a copy of a plain object", () => { const whole = { a: 1, b: 3 }; return copy(whole).b });
