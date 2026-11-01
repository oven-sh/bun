// `f.bind(t, a)` on a plain function: `new b(..)` constructs `f` with the bound arguments first and `f` as `new.target`, and `x instanceof b` asks `f`.
declare const console: any;
const O: any = Object;
function say(n: string, f: () => unknown): void { let r: string; try { r = JSON.stringify(f()) ?? "undefined"; } catch (e: any) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
function Point(this: any, x: number, y: number): void { this.x = x; this.y = y; this.nt = new.target === undefined ? "none" : new.target === Point ? "Point" : typeof new.target; }
Point.prototype.sum = function (this: any): number { return this.x + this.y; };
function see(b: any): unknown { return [typeof b, b.name, b.length, Reflect.ownKeys(b).map(String).join(), "prototype" in b, O.getPrototypeOf(b) === Function.prototype, String(b).replace(/\s+/g, " "), O.prototype.toString.call(b)]; }
const P: any = Point;
say("seen", () => [see(Point.bind(null)), see(Point.bind(null, 1)), see(Point.bind(null, 1, 2)), see(P.bind(null, 1, 2, 3))]);
say("new", () => { const B: any = Point.bind({ ignored: 1 }, 1); const p = new B(2); return [p.x, p.y, p.nt, p.sum(), p instanceof Point, p instanceof B, O.getPrototypeOf(p) === Point.prototype, p.constructor === Point]; });
say("new, no bound argument", () => { const B: any = Point.bind(null); const p = new B(3, 4); return [p.x, p.y, p.nt, p.sum()]; });
say("new, all bound", () => { const B: any = Point.bind(null, 5, 6); const p = new B(7); return [p.x, p.y, p.sum()]; });
say("called", () => { const t: any = {}; const b: any = Point.bind(t, 1); const r = b(2); return [r, t.x, t.y, t.nt]; });
say("called with another this", () => { const t: any = {}, u: any = {}; const b: any = Point.bind(t, 1); b.call(u, 2); return [t.y, u.y]; });
say("instanceof", () => { const B: any = Point.bind(null); return [new P(1, 2) instanceof B, ({}) instanceof B, (1 as any) instanceof B, O.create(Point.prototype) instanceof B]; });
say("Symbol.hasInstance", () => { const B: any = Point.bind(null); return [B[Symbol.hasInstance](new P(1, 2)), Function.prototype[Symbol.hasInstance].call(B, new P(1, 2)), Function.prototype[Symbol.hasInstance].call(B, {})]; });
say("Reflect.construct", () => { const B: any = Point.bind(null, 1); function Other(this: any) {} const a: any = Reflect.construct(B, [2]); const b: any = Reflect.construct(B, [2], Other); const c: any = Reflect.construct(B, [2], B); return [a.nt, a instanceof Point, b.nt, b instanceof Other, b instanceof Point, c.nt, c instanceof Point]; });
say("extends", () => { const B: any = Point.bind(null, 1); class D extends B { constructor() { super(2); } } return "no prototype"; });
say("bound again", () => { const B: any = Point.bind(null, 1); const C: any = B.bind(null, 2); const p = new C(); return [C.name, C.length, p.x, p.y, p.nt, p instanceof Point, p instanceof B, p instanceof C]; });
say("the prototype is replaced later", () => { function F(this: any) { this.a = 1; } const B: any = F.bind(null); const before = new B(); F.prototype = { z: 1 }; const after = new B(); return [before instanceof B, after instanceof B, after.z, before.z]; });
say("it returns an object", () => { function G(this: any, o: any) { return o; } const B: any = G.bind(null); const o = {}; return [new B(o) === o, typeof new B(1)]; });
say("properties", () => { const B: any = Point.bind(null); B.prototype = { q: 1 }; B.extra = 2; const p = new B(1, 2); return [p.q, p.sum(), B.extra, p instanceof B, Reflect.ownKeys(B).join()]; });
say("name and length were defined", () => { function H(a: number, b: number) {} O.defineProperty(H, "name", { value: "other" }); O.defineProperty(H, "length", { value: 9 }); return [H.bind(null).name, H.bind(null, 1).length]; });
say("prototype was asked for first", () => { function I(this: any) { this.i = 1; } const proto = I.prototype; const B: any = I.bind(null); return [O.getPrototypeOf(new B()) === proto, B.name]; });
function typed(this: { v: number }, x: number): number { return this.v + x; }
say("what does not fit", () => { const b: any = (typed as any).bind({ v: 1 }, "s"); return typeof b; });
say("a declared this", () => [typed.bind({ v: 1 })(2), typed.bind({ v: 1 }, 2)(), typed.bind({ v: 1 }).name, typed.bind({ v: 1 }, 2).length]);
const expression = function named(this: any, a: number) { this.a = a; };
say("a function expression", () => { const B: any = expression.bind(null, 4); return [B.name, new B().a, new B() instanceof expression]; });
function outer(c: number): any { return function inner(this: any, a: number) { this.s = c + a; }; }
say("one that captures", () => { const f = outer(10), g = outer(20); const B: any = f.bind(null, 1), C: any = g.bind(null, 1); return [new B().s, new C().s, new B() instanceof f, new B() instanceof g, B.name]; });
let n = 0; const made: any[] = [];
for (let i = 0; i < 20000; i++) made.push(Point.bind(null, i));
for (const B of made) n += new B(1).sum();
console.log(n);
export {};
