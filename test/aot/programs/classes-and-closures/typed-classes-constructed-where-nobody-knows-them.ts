const lines: string[] = [];
function show(value: unknown): string { return JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function " + v.name : v)); }
function attempt(name: string, run: () => unknown): void {
    let said: string;
    try { said = show(run()); } catch (e) { said = "THROWS " + (e as Error).constructor.name + ": " + (e as Error).message; }
    lines.push(name + " | " + said);
}
function hide(value: unknown): any { return value; }
const noted: string[] = [];
class Plain { a: unknown; b: unknown; constructor(a?: unknown, b?: unknown) { this.a = a; this.b = b; } sum(): string { return String(this.a) + String(this.b); } }
class Empty { }
class WithFields { x = 1; y = "s"; z: number[] = []; }
class WithOptional { x?: number; constructor(x?: number) { if (x !== undefined) this.x = x; } }
class WithNumbers { i: number; d: number; constructor(i = 1, d = 1.5) { this.i = i; this.d = d; } }
class Derived extends Plain { c: unknown; constructor(a?: unknown, b?: unknown, c?: unknown) { super(a, b); this.c = c; } }
class DerivedWithout extends Plain { }
class DerivedWithFields extends Plain { extra = "e"; }
class Deep extends Derived { d = 4; }
class ReadsTarget { name: string; constructor() { this.name = new.target.name; } }
class DerivedOfReadsTarget extends ReadsTarget { }
class Returns { v = 1; constructor(other?: object) { if (other) return other as Returns; } }
class Throws { v = 1; constructor(a?: unknown) { if (a === "throw") throw new RangeError("from the constructor"); } }
class WithRest { all: unknown[]; constructor(...all: unknown[]) { this.all = all; } }
class WithPrivate { #p: number; constructor(p = 3) { this.#p = p; } get p(): number { return this.#p; } }
class WithAccessor { _v = 0; get v(): number { return this._v; } set v(x: number) { noted.push("set"); this._v = x; } constructor(x = 2) { this.v = x; } }
class WithStatic { static made = 0; id: number; constructor() { this.id = ++WithStatic.made; } }
abstract class Abstract { kind = "abstract"; }
class OfAbstract extends Abstract { more = 1; }
class Generic<T> { held: T; constructor(held: T) { this.held = held; } }
class OfError extends Error { code: number; constructor(message?: string, code = 7) { super(message); this.code = code; } }
class OfArray extends Array<number> { tag = "t"; }
class OfMap extends Map<string, number> { tag = "m"; }
function Old(this: { a: unknown; n: number }, a?: unknown) { this.a = a; this.n = arguments.length; }
const classes: [string, any][] = [["Plain", Plain], ["Empty", Empty], ["WithFields", WithFields], ["WithOptional", WithOptional], ["WithNumbers", WithNumbers], ["Derived", Derived], ["DerivedWithout", DerivedWithout], ["DerivedWithFields", DerivedWithFields], ["Deep", Deep],
    ["ReadsTarget", ReadsTarget], ["DerivedOfReadsTarget", DerivedOfReadsTarget], ["Returns", Returns], ["Throws", Throws], ["WithRest", WithRest], ["WithPrivate", WithPrivate], ["WithAccessor", WithAccessor], ["WithStatic", WithStatic], ["Abstract", Abstract], ["OfAbstract", OfAbstract],
    ["Generic", Generic], ["OfError", OfError], ["OfArray", OfArray], ["OfMap", OfMap], ["Old", Old]];
function look(o: any): unknown { return [Object.getPrototypeOf(o)?.constructor?.name, { ...o }, Object.keys(o), o instanceof Plain, typeof o.sum === "function" ? o.sum() : 0, o.p, o.v, o.message, o.length, o.size]; }
const ways: [string, (C: any, list: unknown[]) => unknown][] = [
    ["none", C => new C()], ["one", (C, l) => new C(l[0])], ["two", (C, l) => new C(l[0], l[1])], ["three", (C, l) => new C(l[0], l[1], l[2])], ["nine", (C, l) => new C(l[0], l[1], l[2], 4, 5, 6, 7, 8, 9)], ["spread", (C, l) => new C(...l)],
    ["Reflect.construct", (C, l) => Reflect.construct(C, l)], ["bound", (C, l) => new (C.bind(null, l[0]))(l[1])], ["in a loop", (C, l) => { let last: unknown; for (let i = 0; i < 3; i++) last = new C(l[0], i); return last; }],
    ["through a typed parameter", (C, l) => ((K: new (...args: any[]) => object) => new K(l[0], l[1]))(C)], ["by its own constructor property", (C, l) => new (new C(l[0]).constructor)(l[0])],
];
const lists: unknown[][] = [[1, 2, 3], ["a", undefined, null], [1.5, { o: 1 }, [1]], []];
const numbers: unknown[][] = [[1, 2, 3], [4.5, 5, 6], [undefined, 7.25], []];
const texts: unknown[][] = [["m", 3], [undefined, 4], ["n"], []];
const objects: unknown[][] = [[{ v: 5 }], [undefined], [{ v: 6, w: 1 }], []];
for (const [name, C] of classes)
    for (const [way, run] of ways)
        for (let i = 0; i < lists.length; i++)
            attempt(name + " | " + way + " | " + i, () => { noted.length = 0; const made = look(run(hide(C), name === "OfMap" || name === "OfArray" ? [] : /^With(Optional|Numbers|Private|Accessor)$/.test(name) ? numbers[i] : name === "OfError" ? texts[i] : name === "Returns" ? objects[i] : lists[i])); return noted.length ? [made, noted.slice()] : made; });
attempt("another new.target of the family", () => { const o: any = Reflect.construct(hide(Plain), [1, 2], Derived); return [Object.getPrototypeOf(o) === Derived.prototype, o.a, o.b, o.c, o instanceof Derived]; });
attempt("the constructor throws", () => new (hide(Throws))("throw"));
attempt("the constructor returns another object", () => { const other = { v: 2 }; return [new (hide(Returns))(other) === other, look(new (hide(Returns))())]; });
attempt("called without new", () => hide(Plain)(1));
attempt("an untyped class extends a typed one", () => { const U = hide(class extends (hide(Plain) as typeof Plain) { constructor(...args: any[]) { super(...(args as [unknown, unknown])); } }); return look(new U(1, 2)); });
attempt("methods see the fields", () => { let text = ""; for (const C of [Plain, Derived, DerivedWithout, Deep]) text += (new (hide(C))("x", "y") as Plain).sum(); return text; });
attempt("many classes at one site", () => { let n = 0; const all = classes.filter(([name]) => !/^Of|Throws|Abstract/.test(name)).map(([, C]) => C); for (let i = 0; i < 600; i++) n += Object.keys(new all[i % all.length]()).length; return n; });
attempt("objects are apart", () => { const a: any = new (hide(WithFields))(), b: any = new (hide(WithFields))(); a.z.push(1); a.x = 9; return [a, b]; });
console.log(lines.join("\n"));
