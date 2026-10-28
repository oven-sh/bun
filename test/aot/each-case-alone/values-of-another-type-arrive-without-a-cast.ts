// Programs that the type checker accepts under `strict`, without `any`, without a cast and without a declaration that has no body (but the one of console below), and in which a value of another type still arrives at a typed place.
// A compiled program prints what plain Bun prints. Where a rule of the compiler says so it may throw a TypeError instead, but it never reads a value as something that it is not.
declare const console: { log(...values: unknown[]): void };
function t(name: string, f: () => unknown) { let r: string; try { r = String(f()); } catch (e) { r = "threw " + (e instanceof Error ? e.name : typeof e); } console.log(name, r); }
class Animal { name = "animal"; }
class Dog extends Animal { legs = 4; bark(): number { return this.legs * 2; } }
class Cat extends Animal { lives = "nine"; }
interface Options { size: number; label: string }
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
function area(s: Shape): number { switch (s.kind) { case "circle": return s.radius * 3; case "square": return s.side * s.side; } }
enum Color { Red, Green }
interface Merged { extra: number }
class Merged { own = 1; }
t("a wider alias stores into a property: method", () => { const kennel: { pet: Dog } = { pet: new Dog() }; const home: { pet: Animal } = kennel; home.pet = new Cat(); return kennel.pet.bark(); });
t("a wider alias stores into a property: number", () => { const kennel: { pet: Dog } = { pet: new Dog() }; const home: { pet: Animal } = kennel; home.pet = new Cat(); return kennel.pet.legs + 1; });
t("a wider alias stores into a field of a class", () => { class Kennel { pet: Dog = new Dog(); } const kennel = new Kennel(); const home: { pet: Animal } = kennel; home.pet = new Cat(); return kennel.pet.legs + 1; });
t("a wider alias stores a primitive of another kind", () => { const box: { v: number } = { v: 1 }; const wide: { v: number | string } = box; wide.v = "text"; return box.v * 2; });
t("a wider alias stores null", () => { const box: { v: Dog } = { v: new Dog() }; const wide: { v: Dog | null } = box; wide.v = null; return box.v.legs; });
t("a wider alias stores undefined", () => { const box: { v: number } = { v: 1 }; const wide: { v?: number } = box; wide.v = undefined; return box.v.toFixed(1); });
t("a wider alias deletes", () => { const box: { v: number } = { v: 1 }; const wide: { v?: number } = box; delete wide.v; return box.v.toFixed(1); });
t("a wider alias in a callee", () => { const put = (home: { pet: Animal }) => { home.pet = new Cat(); }; const kennel = { pet: new Dog() }; put(kennel); return kennel.pet.bark(); });
t("a wider alias in a hot loop", () => { const kennel = { pet: new Dog() }; const home: { pet: Animal } = kennel; let sum = 0; for (let i = 0; i < 2000; i++) { if (i === 1500) home.pet = new Cat(); sum += kennel.pet.legs; } return sum; });
t("a read-only property is stored through another alias", () => { const fixed: { readonly pet: Dog } = { pet: new Dog() }; const home: { pet: Animal } = fixed; home.pet = new Cat(); return fixed.pet.legs + 1; });
t("the tag of a union is rewritten through an alias", () => { const s: Shape = { kind: "circle", radius: 2 }; const tagged: { kind: "circle" | "square" } = s; tagged.kind = "square"; return area(s).toFixed(1); });
t("a forgotten property comes back as optional", () => { const a = { x: "text" }; const b: {} = a; const c: { x?: number } = b; return (c.x ?? 0) * 2; });
t("in narrows to the wrong member", () => { const f = (x: { a: number } | { b: string }) => ("a" in x ? x.a.toFixed(1) : x.b); const v = { b: "s", a: "no number" }; const onlyB: { b: string } = v; return f(onlyB); });
t("spread of an explicit undefined", () => { const defaults: Options = { size: 1, label: "l" }; const given: Partial<Options> = { size: undefined }; const merged: Options = { ...defaults, ...given }; return merged.size.toFixed(1); });
t("assign of an explicit undefined", () => { const target: Options = { size: 1, label: "l" }; const given: Partial<Options> = { label: undefined }; Object.assign(target, given); return target.label.length; });
t("a tuple reversed", () => { const pair: [number, string] = [1, "a"]; pair.reverse(); return pair[0].toFixed(1); });
t("a tuple sorted", () => { const pair: [string, number] = ["b", 1]; pair.sort(); return pair[0].length; });
t("a tuple shifted", () => { const pair: [number, string] = [1, "a"]; pair.shift(); return pair[0].toFixed(1); });
t("a tuple spliced", () => { const pair: [Dog, Cat] = [new Dog(), new Cat()]; pair.splice(0, 1); return pair[0].bark(); });
t("a tuple filled", () => { const pair: [number, string] = [1, "a"]; pair.fill("z"); return pair[0].toFixed(1); });
t("a tuple copied within", () => { const pair: [number, string] = [1, "a"]; pair.copyWithin(0, 1); return pair[0].toFixed(1); });
t("an array with holes", () => { const list: number[] = new Array<number>(3); return list[0].toFixed(1); });
t("an array made longer", () => { const list: Dog[] = [new Dog()]; list.length = 3; return list[2].legs; });
t("an element deleted", () => { const list: Dog[] = [new Dog()]; delete list[0]; return list[0].legs; });
t("an empty array destructured", () => { const [first]: Dog[] = []; return first.legs; });
t("an array summed over holes", () => { const list: number[] = [1, 2]; list.length = 4; let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; });
t("a character past the end", () => { const s: string = "abc"; const c: string = s[10]; return c.length; });
t("a group that did not take part", () => { const m = /(a)|(b)/.exec("a"); if (m === null) return "none"; const second: string = m[2]; return second.length; });
t("a replacer's missing group", () => "a".replace(/(a)|(b)/, (all: string, first: string, second: string) => String(second.length)));
t("an entry of a record that is not there", () => { const m: Record<string, Dog> = {}; return m["rex"].legs; });
t("an inherited name in a record", () => { const m: Record<string, number> = {}; const v: number = m["constructor"]; return typeof v; });
t("an entry of a record deleted", () => { const m: { [k: string]: number } = { a: 1 }; delete m.a; return m.a.toFixed(1); });
t("a literal type becomes a record", () => { const o = { a: 1, b: "text" }; const narrow: { a: number } = o; const record: Record<string, number> = narrow; return Object.values(record).map(v => v.toFixed(1)).join(); });
t("a generic store through a wider type argument", () => { function add<T>(list: T[], item: T) { list.push(item); } const dogs: Dog[] = []; add<Animal>(dogs, new Cat()); return dogs[0].bark(); });
t("a generic store under any key", () => { function put<T>(o: T, k: keyof T, v: T[keyof T]) { o[k] = v; } const d = new Dog(); put(d, "legs", "text"); return d.legs * 2; });
t("a generator resumed without a value", () => { const seen: number[] = []; function* g(): Generator<number, void, string> { const s = yield 1; seen.push(s.length); } const it = g(); it.next(); it.next(); return seen; });
t("an overload whose body disagrees", () => { function pick(x: number): number; function pick(x: string): string; function pick(x: number | string): number | string { return typeof x === "number" ? "text" : 1; } return pick(1).toFixed(1); });
t("an interface merged into a class", () => { return new Merged().extra.toFixed(1); });
t("a field read by a method that the base constructor calls", () => { class Base { constructor() { this.init(); } init(): void {} } class Derived extends Base { label: string = "set"; seen = 0; init() { this.seen = this.label.length; } } return new Derived().seen; });
t("a field read before the constructor sets it", () => { class Early { size: number; constructor() { this.show(); this.size = 1; } shown = ""; show() { this.shown = this.size.toFixed(1); } } return new Early().shown; });
t("this leaves a constructor that then throws", () => { const registry: Leaky[] = []; class Leaky { pet: Dog; constructor(fail: boolean) { registry.push(this); if (fail) throw new Error("failed"); this.pet = new Dog(); } } try { new Leaky(true); } catch {} return registry[0].pet.legs; });
t("a variable read by a closure before it is assigned", () => { let v: number; const read = () => v + 1; const r = read(); v = 1; return r; });
t("a narrowed variable cleared by a closure", () => { let d: Dog | null = new Dog(); const clear = () => { d = null; }; if (d !== null) { clear(); return d.legs; } return "null"; });
t("a narrowed property cleared by a callee", () => { const o: { d: Dog | null } = { d: new Dog() }; const clear = (x: { d: Dog | null }) => { x.d = null; }; if (o.d !== null) { clear(o); return o.d.legs; } return "null"; });
t("a narrowed property changed by a getter", () => { let n = 0; const o: { readonly v: number | string } = { get v() { return n++ === 0 ? 1 : "text"; } }; return typeof o.v === "number" ? o.v.toFixed(1) : "text first"; });
t("a number outside an enum", () => { const n: number = 7; const c: Color = n; const names: Record<Color, string> = { [Color.Red]: "r", [Color.Green]: "g" }; return names[c].length; });
t("a method taken off its object", () => { const d = new Dog(); const bark = d.bark; return bark(); });
t("a method handed to a built-in", () => { const d = new Dog(); return [1].map(d.bark).join(); });
t("a function that returns something as void", () => { const f: () => void = () => new Cat(); const r = f(); return typeof r; });
t("a callback called with more than it declares", () => ["1", "2", "3"].map(parseInt).join());
t("a method parameter narrower than the interface says", () => { interface Handler { handle(a: Animal): number } const h: Handler = { handle(d: Dog) { return d.bark(); } }; return h.handle(new Cat()); });
t("a literal in place of an instance", () => { class Point { x = 1; twice() { return this.x * 2; } } const fake: Point = { x: 5, twice() { return -1; } }; const use = (p: Point) => [p.twice(), p instanceof Point].join(); return use(fake) + " " + use(new Point()); });
t("a getter in place of a property", () => { let n = 0; const p: { x: number } = { get x() { return ++n; } }; return p.x + p.x; });
t("a proxy in place of an instance", () => { const p: Dog = new Proxy(new Dog(), { get: (target, key) => (key === "legs" ? "many" : Reflect.get(target, key)) }); return p.legs + 1; });
