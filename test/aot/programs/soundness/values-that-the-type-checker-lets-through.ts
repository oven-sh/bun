// The holes of TypeScript's own type system, each in a try: the compiled program may print what plain prints or a TypeError, never garbage.
function attempt(name: string, f: () => unknown) { try { console.log(name, String(f())); } catch (e) { console.log(name, "threw", (e as Error).name); } }
class Animal { name: string; constructor(n: string) { this.name = n; } }
class Dog extends Animal { legs: number = 4; bark(): number { return this.legs * 2; } }
class Cat extends Animal { lives: string = "nine"; }
attempt("array covariance", () => { const dogs: Dog[] = [new Dog("a")]; const animals: Animal[] = dogs; animals.push(new Cat("c")); let s = 0; for (const d of dogs) s += d.legs; return s; });
attempt("array covariance call", () => { const dogs: Dog[] = [new Dog("a")]; const animals: Animal[] = dogs; animals[0] = new Cat("c"); return dogs[0].bark(); });
interface Handler { handle(a: Animal): number }
attempt("method bivariance", () => { const h: Handler = { handle(d: Dog) { return d.legs + 1; } }; return h.handle(new Cat("c")); });
function isDog(a: Animal): a is Dog { return true; }
attempt("lying predicate", () => { const a: Animal = new Cat("c"); return isDog(a) ? a.legs + 1 : 0; });
attempt("out of bounds", () => { const xs: number[] = [1, 2]; const v: number = xs[5]; return v + 1; });
attempt("out of bounds object", () => { const ds: Dog[] = []; return ds[0].legs; });
attempt("index signature", () => { const m: Record<string, number> = { a: 1 }; const v: number = m["b"]; return v * 2; });
class Unset { x!: number; y!: Dog; sum() { return this.x + 1; } }
attempt("definite assignment", () => new Unset().sum());
attempt("definite assignment object", () => new Unset().y.legs);
attempt("non-null", () => { const m = new Map<string, Dog>(); return m.get("k")!.legs; });
enum Color { Red, Green }
attempt("enum out of range", () => { const c: Color = JSON.parse("7") as Color; const names: string[] = ["r", "g"]; return names[c].length; });
attempt("narrowing undone", () => { const o: { d: Dog | null } = { d: new Dog("a") }; const clear = () => { o.d = null; }; if (o.d !== null) { clear(); return o.d.legs; } return -1; });
attempt("void callback", () => { const f: () => void = () => 5; const r = f(); return typeof r; });
interface Pt { x: number; y: number }
attempt("getter as field", () => { let n = 0; const p: Pt = { get x() { return ++n; }, y: 1 }; return p.x + p.x + p.y; });
attempt("other layout", () => { const len = (p: Pt) => p.x * p.x + p.y * p.y; return [len({ x: 1, y: 2 }), len({ y: 2, x: 1 }), len(Object.assign(new Dog("d"), { x: 3, y: 4 })), len(Object.create({ x: 5, y: 6 }))].join(); });
attempt("tuple push", () => { const t: [number, string] = [1, "a"]; t.push(2); t.pop(); t.pop(); const s: string = t[1]; return s.length; });
attempt("readonly alias", () => { const o = { v: 1 }; const r: { readonly v: number } = o; const before = r.v; o.v = 2; return before + r.v; });
attempt("extracted method", () => { const d = new Dog("a"); const f = d.bark; return f(); });
attempt("any leak", () => { const a: any = "str"; const n: number = a; return n * 2; });
attempt("any leak object", () => { const a: any = { legs: "many" }; const d: Dog = a; return d.legs + 1; });
attempt("any leak into array", () => { const xs: number[] = [1]; (xs as any).push("s"); let t = 0; for (const x of xs) t += x; return t; });
attempt("any leak into field", () => { const d = new Dog("a"); (d as any).legs = "x"; return d.bark(); });
attempt("optional", () => { const o: { a?: number } = {}; const f = (p: { a?: number }) => p.a! + 1; return f(o); });
attempt("generic", () => { function first<T>(xs: T[]): T { return xs[0]; } const v: number = first<number>([]); return v + 1; });
attempt("spread loses methods", () => { const d = { ...new Dog("a") } as Dog; return d.bark(); });
attempt("parsed", () => { const d = JSON.parse('{"name":1,"legs":"4"}') as Dog; return d.legs + 1; });
attempt("delete", () => { const o: { a: number; b?: number } = { a: 1, b: 2 }; delete o.b; delete (o as any).a; return o.a + 1; });
attempt("proto swap", () => { const d = new Dog("a"); Object.setPrototypeOf(d, Cat.prototype); return d.bark(); });
attempt("class patched", () => { const d = new Dog("a"); (Dog.prototype as any).bark = function () { return "patched"; }; return d.bark(); });
