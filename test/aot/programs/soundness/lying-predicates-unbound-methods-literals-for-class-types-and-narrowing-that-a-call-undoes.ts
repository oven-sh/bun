// What TypeScript lets through: reads past the end of an array, type predicates and assertions that lie, methods taken off their objects, literals for class types, readonly members changed through an alias, accessors behind the fields of an interface, narrowing that a call undoes, tuples that shrink.
function show(label: string, f: () => unknown) {
    try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name); }
}
// 8. out of bounds
show("out of bounds", () => { const a: number[] = [1, 2, 3]; const f = (i: number) => a[i] + 1; return [f(10), f(-1), f(1.5), f(2)].join(); });
show("holes", () => { const a: number[] = [1, , 3] as number[]; let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; });
show("string array oob", () => { const a: string[] = ["x"]; const f = (i: number) => a[i].length; return f(0) + "," + f(3); });
// 9. a lying type predicate
interface Foo { foo: number; inner: { v: number } }
function isFoo(x: unknown): x is Foo { return true; }
show("lying predicate", () => { const f = (x: unknown) => isFoo(x) ? x.foo + 1 : -1; return [f({ foo: 1, inner: { v: 1 } }), f({ bar: 1 }), f("text"), f(7)].join(); });
show("lying predicate deep", () => { const f = (x: unknown) => isFoo(x) ? x.inner.v : -1; return f({ foo: 1 }); });
function assertFoo(x: unknown): asserts x is Foo {}
show("lying assertion", () => { const f = (x: unknown) => { assertFoo(x); return x.foo * 2; }; return [f({ foo: 4, inner: { v: 1 } }), f({}), f("s")].join(); });
// 10. unbound method
class Counter { n = 1; inc() { return ++this.n; } }
show("unbound method", () => { const c = new Counter(); const m = c.inc; return m(); });
show("method on another object", () => { const c = new Counter(); const o = { n: 41.5, inc: c.inc }; return o.inc() + "," + c.n; });
show("method.call", () => Counter.prototype.inc.call({ n: "7" } as unknown as Counter));
// 11. a literal for a class type
class Point { x = 1; y = 2; norm() { return this.x * this.x + this.y * this.y; } }
function readX(p: Point) { return p.x + p.y; }
show("literal as class", () => { const p: Point = { x: 10, y: 20, norm() { return -1; } }; return [readX(p), p.norm(), p instanceof Point, readX(new Point())].join(); });
show("reordered literal as class", () => { const p: Point = { norm: () => 5, y: 20, x: 10 }; return [readX(p), p.norm()].join(); });
show("wider literal as class", () => { const w = { z: 0, y: 20.5, x: "10" as unknown as number, norm() { return 3; } }; const p: Point = w; return [readX(p), p.norm()].join(); });
// 12. readonly through a mutable alias
interface RO { readonly v: number }
show("readonly alias", () => { const m = { v: 1 }; const r: RO = m; const f = (r: RO, g: () => void) => { const a = r.v; g(); return a + r.v; }; return f(r, () => { m.v = 10; }); });
class ROClass { constructor(readonly v: number) {} }
show("readonly class", () => { const c = new ROClass(1); const f = (r: ROClass, g: () => void) => { const a = r.v; g(); return a + r.v; }; return f(c, () => { (c as { v: number }).v = 10; }); });
show("readonly array", () => { const m = [1, 2]; const r: readonly number[] = m; const f = (r: readonly number[], g: () => void) => { const a = r.length + r[0]; g(); return a + "," + r.length + "," + r[0]; }; return f(r, () => { m.unshift(9); }); });
// 18. an accessor behind a field of an interface
interface HasX { x: number }
class Acc { calls = 0; get x() { return ++this.calls; } }
class Plain { x = 100; }
function twice(h: HasX) { return h.x + h.x; }
show("accessor for field", () => [twice(new Acc()), twice(new Plain()), twice({ x: 5 }), twice({ get x() { return 7; } }), twice(Object.create({ x: 8 }) as HasX)].join());
function store(h: HasX, v: number) { h.x = v; return h.x; }
show("store to accessor", () => { let seen = 0; const o = { get x() { return seen; }, set x(v: number) { seen = v * 2; } }; return [store(o, 4), store(new Plain(), 4), store(Object.create({ x: 8 }) as HasX, 4)].join(); });
show("store to getter only", () => store(new Acc() as HasX, 4));
show("store to frozen", () => store(Object.freeze({ x: 1 }) as HasX, 4));
// 20. narrowing that a call undoes
interface Box { v?: { n: number } }
show("narrowing undone", () => { const b: Box = { v: { n: 1 } }; const clear = () => { b.v = undefined; }; if (b.v !== undefined) { clear(); return b.v.n; } return "none"; });
show("let narrowing undone", () => { let s: string | number = "text"; const change = () => { s = 5; }; if (typeof s === "string") { change(); return s.length; } return "none"; });
// 22. a discriminant changed through an alias
type Shape = { kind: "c"; r: number } | { kind: "s"; side: string };
show("discriminant alias", () => { const s: Shape = { kind: "c", r: 2 } as Shape; const any = s as any; const f = (s: Shape, g: () => void) => { if (s.kind === "c") { g(); return s.r * 2; } return s.side; }; return f(s, () => { any.kind = "s"; delete any.r; any.side = "x"; }); });
// 23. tuples
show("tuple pop", () => { const t: [number, number] = [1, 2]; t.pop(); const f = (t: [number, number]) => t[0] + t[1]; return f(t) + "," + t.length; });
show("tuple push", () => { const t: [number, string] = [1, "a"]; t.push(5); const [a, b, ...rest] = t as unknown as unknown[]; return [a, b, rest.length].join(); });
