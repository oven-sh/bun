// The copy goes on through fields, arrays, results and callbacks before the member is read.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; b: number }
class C implements S { a = 1; get b(): number { return 2 } }
class Holder { held: S; constructor(held: S) { this.held = held } }
const copy = (s: S): S => ({ ...s });
const sum = (list: S[]): number => { let total = 0; for (const each of list) total += each.b; return total };
row("a field", () => new Holder(copy(new C())).held.b + 1);
row("an array", () => sum([copy(new C()), { a: 1, b: 5 }]));
row("map", () => [new C(), new C()].map(copy).map(each => each.b).join());
row("stored into a number field", () => { const target = { n: 0 }; target.n = copy(new C()).b; return typeof target.n });
row("a default", () => { const { b = 7 } = copy(new C()) as Partial<S>; return b });
row("nullish", () => (copy(new C()).b as number | undefined) ?? 9);
