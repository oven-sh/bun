// More ways in which a value of another type, or an object in another state, arrives at a typed place without any, cast, guard or bodiless declaration.
declare const console: { log(...values: unknown[]): void };
declare class URL { constructor(text: string); pathname: string; search: string; }
function t(name: string, f: () => unknown) { let r: string; try { r = String(f()); } catch (e) { r = "threw " + (e instanceof Error ? e.name : typeof e); } console.log(name, r); }
class Animal { name = "animal"; }
class Dog extends Animal { legs = 4; bark(): number { return this.legs * 2; } }
class Cat extends Animal { lives = "nine"; }
interface Inherits { legs: number }
class Inherits { own = 1; }
Object.defineProperty(Inherits.prototype, "legs", { value: 4, writable: true, configurable: true });
t("an optional parameter forgotten and added again", () => { const f = (a: number, b?: Dog) => (b ? b.bark() : a); const g: (a: number) => number = f; const h: (a: number, b?: Cat) => number = g; return h(1, new Cat()); });
t("a string where an object type is declared", () => { const len = (x: { length: number }) => x.length + 1; return [len("abc"), len([1, 2]), len((a: number, b: number) => a + b), len({ length: 7 }), len(new Uint8Array(3))].join(); });
t("a number where an object type is declared", () => { const show = (x: { toFixed(digits: number): string }) => x.toFixed(1); return [show(1.25), show({ toFixed: d => "own " + d })].join(); });
t("primitives and objects in one hot loop", () => { const len = (x: { length: number }) => x.length; const all: { length: number }[] = ["ab", [1], { length: 5 }, "c"]; let sum = 0; for (let i = 0; i < 4000; i++) sum += len(all[i & 3]); return sum; });
t("a host object where an interface is declared", () => { const path = (u: { pathname: string; search: string }) => u.pathname + u.search; return [path(new URL("http://h/a?b")), path({ pathname: "/p", search: "" })].join(); });
t("an error where an interface is declared", () => { const text = (e: { message: string; name: string }) => e.name + e.message; return [text(new TypeError("m")), text({ name: "n", message: "o" })].join(); });
t("a required property on the prototype", () => { return new Inherits().legs + 1; });
t("an accessor of a class where a property is declared", () => { class Getter { #n = 0; get x(): number { return ++this.#n; } } const twice = (p: { readonly x: number }) => p.x + p.x; return [twice(new Getter()), twice({ x: 5 })].join(); });
t("an optional property found on the prototype", () => { class Plain { own = 1; } const read = (o: { own: number; extra?: number }) => o.extra ?? -1; const before = read(new Plain()); Object.defineProperty(Plain.prototype, "extra", { value: 9, configurable: true }); return [before, read(new Plain())].join(); });
t("a method replaced on the instance", () => { const d = new Dog(); const call = (x: Dog) => x.bark(); const before = call(d); d.bark = () => 5; return [before, call(d), call(new Dog())].join(); });
t("a method replaced on the prototype", () => { class Local { n = 2; twice(): number { return this.n * 2; } } const call = (x: Local) => x.twice(); const l = new Local(); const before = call(l); Local.prototype.twice = function () { return -this.n; }; return [before, call(l)].join(); });
t("a map of a wider type", () => { const dogs = new Map<string, Dog>(); const animals: Map<string, Animal> = dogs; animals.set("c", new Cat()); const d = dogs.get("c"); return d ? d.bark() : "none"; });
t("a set of a wider type", () => { const dogs = new Set<Dog>(); const animals: Set<Animal> = dogs; animals.add(new Cat()); let sum = 0; for (const d of dogs) sum += d.legs; return sum; });
t("a promise of a wider type", () => { const box: { p: Promise<Dog> } = { p: Promise.resolve(new Dog()) }; const wide: { p: Promise<Animal> } = box; wide.p = Promise.resolve(new Cat()); box.p.then(d => console.log("resolved", d.legs + 1)); return "asked"; });
t("an array of arrays of a wider type", () => { const packs: Dog[][] = [[new Dog()]]; const groups: Animal[][] = packs; groups[0].push(new Cat()); return packs[0][1].bark(); });
t("a typed store into a frozen object", () => { const d = Object.freeze(new Dog()); const put = (x: Dog) => { x.legs = 3; }; put(new Dog()); put(d); return d.legs; });
t("a typed store into a sealed object", () => { const d = Object.seal(new Dog()); const put = (x: Dog) => { x.legs = 3; }; put(d); return d.legs; });
t("a typed store of a read-only property", () => { const d = new Dog(); Object.defineProperty(d, "legs", { value: 8, writable: false }); const put = (x: Dog) => { x.legs = 3; }; put(d); return d.legs; });
t("a getter planted after the test", () => { const d = new Dog(); const sum = (x: Dog, plant: boolean) => { const a = x.legs; if (plant) Object.defineProperty(x, "legs", { get: () => 100, configurable: true }); return a + x.legs; }; return [sum(new Dog(), false), sum(d, true), sum(d, false)].join(); });
t("a prototype changed after the test", () => { class Other { bark(): number { return -1; } } const d = new Dog(); const call = (x: Dog, change: boolean) => { const a = x.bark(); if (change) Object.setPrototypeOf(x, Other.prototype); return a + x.bark(); }; return [call(new Dog(), false), call(d, true), d instanceof Dog].join(); });
