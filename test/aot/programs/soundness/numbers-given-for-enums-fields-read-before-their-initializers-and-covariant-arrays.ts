// What TypeScript lets through: a fraction, 2 ** 40 and NaN for a numeric enum, fields read by an overridden method before they are initialized, fields that are never assigned, covariant arrays, bivariant methods, an optional alias of a required field.
function show(label: string, f: () => unknown) {
    try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name); }
}
// 1. number into a numeric enum
enum E { A, B, C }
enum Flags { None = 0, X = 1, Y = 2, Z = 4 }
function addQuarter(e: E) { return e + 0.25; }
function orFlags(a: Flags, b: Flags): Flags { return a | b; }
function keep(e: E): E { return e; }
class HoldsEnum { e: E = E.A; f: Flags = Flags.None; constructor(e: E, f: Flags) { this.e = e; this.f = f; } }
const argc: number = process.argv.length; // 2 under plain, 1 or 2 compiled: not printed
const half: number = Math.min(argc, 0) + 2.5;
const big: number = Math.min(argc, 0) + 2 ** 40;
const nan: number = Math.min(argc, 0) / 0;
show("enum half", () => addQuarter(half));
show("enum big", () => addQuarter(big));
show("enum nan", () => addQuarter(nan));
show("enum keep", () => [keep(half), keep(big), keep(nan), keep(-0 as number)].map(x => Object.is(x, -0) ? "-0" : x).join());
show("enum field", () => { const h = new HoldsEnum(half, big); return h.e + "," + h.f + "," + (h.e * 2) + "," + (h.f + 1); });
show("enum array", () => { const a: E[] = [E.A, E.B]; a.push(half); a.push(big); return a.join() + "|" + a.map(x => x + 1).join(); });
show("flags", () => orFlags(half, Flags.Z) + "," + orFlags(big + 1, Flags.Y));
show("enum switch", () => { const f = (e: E) => { switch (e) { case E.A: return "A"; case E.B: return "B"; case E.C: return "C"; default: return "other " + e; } }; return [f(half), f(big), f(1), f(nan)].join(); });
show("enum index", () => { const names = ["a", "b", "c"]; const f = (e: E) => names[e]; return [f(half), f(big), f(2), f(-1 as number)].join(); });
show("enum reverse", () => [E[half], E[1], E[big]].join());

// 2. a base constructor calls an overridden method that reads fields of the derived class
class Base { log: string[] = []; constructor() { this.init(); } init() { this.log.push("base"); } }
class Derived extends Base {
    n: number = 5; s: string = "s"; b: boolean = true; o: { v: number } = { v: 1 }; a: number[] = [1]; i: number = 7;
    init() { this.log.push([this.n, this.s, this.b, this.o, this.a, typeof this.i].join("/")); this.log.push(String(this.n + 1)); }
}
show("fields before init", () => new Derived().log.join(";"));
class Derived2 extends Base {
    o: { v: number } = { v: 1 };
    init() { try { this.log.push(String(this.o.v)); } catch (e) { this.log.push("threw " + (e as Error).constructor.name); } }
}
show("object field before init", () => new Derived2().log.join(";"));

// 3. definite assignment that never happens
class Never { x!: number; y!: string; z!: { v: number }; w!: boolean; sum() { return this.x + 1; } }
show("never assigned", () => { const n = new Never(); return [n.x, n.y, n.z, n.w, n.sum(), "x" in n, Object.keys(n).join("+")].join(); });
class Declared { declare x: number; y = 1; }
show("declared field", () => { const d = new Declared(); return [d.x, "x" in d, Object.keys(d).join("+")].join(); });

// 4. array covariance
class Animal { name = "animal"; }
class Dog extends Animal { bark() { return "woof " + this.tricks; } tricks = 3; }
class Cat extends Animal { lives = 9; }
show("covariant array", () => { const dogs: Dog[] = [new Dog()]; const animals: Animal[] = dogs; animals.push(new Cat()); return dogs.map(d => { try { return d.tricks + ":" + d.bark(); } catch (e) { return "threw " + (e as Error).constructor.name; } }).join(); });
show("covariant numbers", () => { const n: number[] = [1, 2]; const u: (number | string)[] = n; u.push("three"); let t = 0 as number | string; for (const x of n) t = (t as number) + x; return t; });

// 5. bivariant method parameters
interface Handler { handle(a: Animal): string }
show("bivariant method", () => { const h: Handler = { handle(d: Dog) { return String(d.tricks * 2); } }; return h.handle(new Cat()) + "," + h.handle(new Dog()); });

// 6. optional alias
show("optional alias", () => { const strict: { a: number; b: number } = { a: 1, b: 2 }; const loose: { a?: number; b: number } = strict; loose.a = undefined; const r1 = strict.a + 1; delete loose.a; return r1 + "," + (strict.a + 1) + "," + Object.keys(strict).join("+"); });
