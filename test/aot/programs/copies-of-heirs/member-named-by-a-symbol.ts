// The member that the prototype provides is named by a symbol.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
const tag: unique symbol = Symbol("tag");
interface S { a: number; [tag]: number }
const base = { [tag]: 2 };
const heir = (): S => Object.assign(Object.create(base), { a: 1 });
const copy = (s: S): S => ({ ...s });
row("the heir", () => heir()[tag]);
row("the copy", () => copy(heir())[tag] + 1);
