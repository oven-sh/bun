// A round through the language, one probe of many. It prints what plain Bun prints.
function say(label: string, v: unknown): void { console.log(label + " " + typeof v + " " + String(v)); }
class Pt { constructor(public a: number, public b: string) {} d(): string { return this.b + ":" + (this.a + 1); } }
class Sub extends Pt { constructor(v: any, w: any) { super(v, w); } }
class Other { q = 1; }
class Ret { constructor(x: any) { if (x) return x; } }
class Arrow extends Ret { n = 2; h = (k: number): number => this.n * k; constructor(x: any) { super(x); } m(): number { return this.n + 1; } }
const C: any = Pt;
say("typed", new Pt(1, "s").d()); say("any", new C("x", 1).d()); say("none", new C().d());
say("reflect", Reflect.construct(Pt, [{}, []]).d());
const nt: any = Reflect.construct(Pt, ["a", 2], Other);
say("new-target", (Object.getPrototypeOf(nt) === Other.prototype) + "" + nt.a + nt.b + typeof nt.d); say("new-target-d", Pt.prototype.d.call(nt));
say("sub", new Sub("m", 2).d()); say("sub-ok", new Sub(1, "k").d()); say("sub-none", new Sub(undefined, null).d());
say("bound-new", new (C.bind(null, "bb"))(3).d()); say("spread-new", new C(...["sp", 9]).d());
say("ctor-prop", new (new Pt(1, "s") as any).constructor("cp", 0).d());
say("arrow-own", new Arrow(null).h(3) + new Arrow(null).m());
const plain: any = new Arrow({ n: "str", extra: 1 }); say("arrow-plain", plain.h(3) + "|" + Object.keys(plain).join() + "|" + typeof plain.m);
plain.n = "x"; say("arrow-plain-changed", plain.h(3));
const arr: any = new Arrow([1, 2]); say("arrow-array", arr.h(2) + "|" + arr.length);
const viaOther: any = Reflect.construct(Arrow, [null], Other); say("arrow-new-target", viaOther.h(2) + "|" + (viaOther instanceof Other) + typeof viaOther.m);
say("arrow-m-on-plain", Arrow.prototype.m.call(plain));
function Old(this: any, a: number, b: number) { this.a = a; this.b = b; }
Old.prototype.len = function (this: { a: number; b: number }): number { return this.a * this.b; };
const O: any = Old;
say("es5", new O(2, 3).len()); say("es5-bad", new O("4", "5").len()); say("es5-bad2", new O("x", {}).len()); say("es5-none", new O().len());
const t: any = {}; O.call(t, 6, "7"); say("es5-call", O.prototype.len.call(t));
say("es5-reflect", typeof (Reflect.construct(O, [1, 2], Other) as any).len);
