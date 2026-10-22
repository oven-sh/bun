// A round through the language, one probe of many. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
class P {
  constructor(public a: number, public b: string) {}
  d(): string { return this.b + ":" + (this.a + 1); }
}
class S extends P { constructor(v: any, w: any) { super(v, w); } }
class T extends P { z: number; constructor(v: any) { super(v, v); this.z = v; } zz(): number { return this.z + this.a; } }
class Other { q = 1; }
const C: any = P;
show("typed", () => new P(1, "s").d());
show("any", () => new C("x", 1).d());
show("any-none", () => new C().d());
show("reflect", () => Reflect.construct(P, [{}, []]).d());
show("reflect-nt", () => { const o = Reflect.construct(P, ["a", 2], Other); return Object.getPrototypeOf(o) === Other.prototype ? JSON.stringify(o) : "bad"; });
show("reflect-nt-d", () => { const o = Reflect.construct(P, ["a", 2], Other); return P.prototype.d.call(o); });
show("sub", () => new S("m", 2).d());
show("sub-2", () => new S(undefined, null).d());
show("sub-t", () => new T("t").zz());
show("sub-t-2", () => new T({ valueOf() { return 2; } }).zz());
show("call-ctor", () => C(1, "s"));
function Old(this: any, a: number, b: string) { this.a = a; this.b = b; }
Old.prototype.d = function (this: { a: number; b: string }): string { return this.b + "/" + (this.a + 1); };
const O: any = Old;
show("old", () => new O(1, "s").d());
show("old-any", () => new O("x", 1).d());
show("old-call", () => { const t: any = {}; O.call(t, [], {}); return O.prototype.d.call(t); });
show("bound-new", () => new (C.bind(null, "bb"))(3).d());
show("spread-new", () => new C(...["sp", 9]).d());
const classes: any[] = [P, S, T];
for (const K of classes) show("by-value-" + K.name, () => new K("k", 8).d());
