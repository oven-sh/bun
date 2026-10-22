// A round through the language, one probe of many. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
// A parent constructor that returns another object.
class Ret { constructor(x: any) { if (x) return x; } }
class Sub extends Ret { y = 1; z: string = "z"; constructor(x: any) { super(x); } sum(): string { return this.z + (this.y + 1); } }
show("ret-none", () => new Sub(null).sum());
show("ret-obj", () => { const o: any = new Sub({ foo: 1 }); return JSON.stringify(o) + (o instanceof Sub); });
show("ret-arr", () => { const o: any = new Sub([1, 2]); return JSON.stringify(o) + o.y + o.z; });
show("ret-fn", () => { const o: any = new Sub(function () {}); return typeof o + o.y + o.z; });
show("ret-frozen", () => new Sub(Object.freeze({})));
show("ret-sum", () => Sub.prototype.sum.call(new Sub({ y: "q" }) as any));
// A typed parent under an untyped child, with wrong arguments through super().
class Base { a: number; b: string; constructor(a: number, b: string) { this.a = a; this.b = b; } d(): string { return this.b + (this.a + 1); } }
class Mid extends Base { c: number; constructor(a: any, b: any, c: number) { super(a, b); this.c = c; } e(): string { return this.d() + this.c; } }
class Leaf extends Mid { constructor(...r: any[]) { super(r[0], r[1], r[2]); } }
show("super-ok", () => new Mid(1, "b", 2).e());
show("super-bad", () => new Mid("a", 2, 3).e());
show("super-bad2", () => new Mid({}, [], "c" as any).e());
show("leaf", () => new Leaf("x", {}, null).e());
show("leaf-ok", () => new Leaf(1, "s", 2).e());
// ES5 constructor functions with typed parameters.
function Point(this: any, x: number, y: number) { this.x = x; this.y = y; }
Point.prototype.len = function (this: { x: number; y: number }): number { return this.x * this.x + this.y * this.y; };
const PointAny: any = Point;
show("es5-ok", () => new PointAny(1, 2).len());
show("es5-bad", () => new PointAny("3", {}).len());
show("es5-bad2", () => new PointAny().len());
for (const args of [[1, 2], ["a", "b"], [{}, 1]]) show("es5-loop", () => new PointAny(...args).len());
// Arrow functions in fields capture the object.
class Handlers { n = 2; h = (k: number): number => this.n * k; g = (): string => "g" + this.n; }
const hs = new Handlers();
show("field-arrow", () => hs.h(3) + hs.g());
show("field-arrow-any", () => (hs as any).h("4"));
show("field-arrow-detached", () => { const { h } = hs; return (h as any)({ valueOf: () => 5 }); });
show("field-arrow-call", () => hs.h.call({ n: 100 } as any, 2));
show("field-arrow-copied", () => { const o: any = Object.assign({}, hs); o.n = "other"; return o.h(2) + o.g(); });
show("field-arrow-proto", () => { const o: any = Object.create(hs); o.n = 50; return o.h(2); });
class SubHandlers extends Handlers { extra = "e"; }
show("field-arrow-sub", () => new SubHandlers().h(7));
// Bound functions with bound arguments of the wrong type.
function three(a: number, b: string, c: { k: number }): string { return b + (a + c.k); }
show("bound-ok", () => three.bind(null, 1, "s")({ k: 2 }));
show("bound-bad", () => (three as any).bind(null, "1", 2)({ k: "3" }));
show("bound-bad2", () => (three as any).bind(null, {}, {}, {})());
show("bound-this", () => Base.prototype.d.bind({ a: "A", b: 1 } as any)());
const bounds: any[] = [three.bind(null, 1), (three as any).bind(null, "x")];
for (const b of bounds) show("bound-loop", () => b("m", { k: 1 }));
