// Object.create is given descriptors: what they do not make enumerable is not copied, nor what the prototype provides.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; b: number; c: number }
const base = { b: 2 };
const heir = (): S => Object.create(base, { a: { value: 1, enumerable: true }, c: { value: 3 } });
const copy = (s: S): S => ({ ...s });
row("the heir", () => heir().a + heir().b + heir().c);
row("the copy", () => { const made = copy(heir()); return made.a + " " + made.b + " " + made.c });
row("added", () => copy(heir()).b + copy(heir()).c);
