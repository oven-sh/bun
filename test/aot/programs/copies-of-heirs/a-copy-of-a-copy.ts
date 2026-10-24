// What the first copy lacks the copy of the copy lacks too, though every object of the first copy's type holds all it has itself.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface W { b: number }
class C implements W { a = 1; get b(): number { return 2 } }
const first = (w: W) => ({ ...w, one: 1 });
const second = (made: ReturnType<typeof first>) => ({ ...made, two: 2 });
const third = ({ one, ...rest }: ReturnType<typeof second>) => rest;
row("the first", () => first(new C()).b + 1);
row("the second", () => second(first(new C())).b + 1);
row("the third", () => third(second(first(new C()))).b + 1);
row("its keys", () => Object.keys(third(second(first(new C())))).join());
row("of a plain object", () => third(second(first({ b: 5 }))).b + 1);
