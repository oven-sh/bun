// The function that copies a type parameter is reached as a method, a member of an object, a static method, a callback, through another generic function.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; b: number }
class C implements S { a = 1; get b(): number { return 2 } }
const heir = (): S => new C();
const copy = <T extends object>(value: T): T => ({ ...value });
const tools = { copy<T extends object>(value: T): T { return { ...value } }, arrow: <T extends object>(value: T): T => ({ ...value }) };
class Copier { static of<T extends object>(value: T): T { return { ...value } } one<T extends object>(value: T): T { return { ...value } } }
const through = <T extends object>(value: T): T => copy(value);
const twice = <T extends object>(value: T): T => through(through(value));
const apply = <T extends object>(f: (value: T) => T, value: T): T => f(value);
const pick = (which: boolean) => (which ? copy : through);
row("a method of a literal", () => tools.copy(heir()).b + 1);
row("an arrow in a literal", () => tools.arrow(heir()).b + 1);
row("a static method", () => Copier.of(heir()).b + 1);
row("a method", () => new Copier().one(heir()).b + 1);
row("through another", () => through(heir()).b + 1);
row("through two", () => twice(heir()).b + 1);
row("a callback", () => apply(copy, heir()).b + 1);
row("map", () => [heir()].map(copy)[0].b + 1);
row("one of two", () => pick(true)(heir()).b + 1);
row("a plain object", () => tools.copy({ a: 1, b: 2 }).b + Copier.of({ a: 1, b: 2 }).b + apply(copy, { a: 1, b: 2 }).b);
