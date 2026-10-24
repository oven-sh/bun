// A round through the language: this of constructors. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
class Ret { constructor(x: any) { if (x) return x; } }
class SubArrow extends Ret {
  n = 2; s: string = "s";
  h = (k: number): number => this.n * k;
  t = (): string => this.s + this.n;
  constructor(x: any) { super(x); }
  m(): number { return this.n + 1; }
}
class Other { o = 1; }
show("own", () => { const v = new SubArrow(null); return v.h(3) + v.t() + v.m(); });
show("plain", () => { const v: any = new SubArrow({ n: "str", extra: 1 }); return v.h(3) + v.t() + Object.keys(v); });
show("plain-changed", () => { const v: any = new SubArrow({}); v.n = "x"; v.s = 5; return v.h(3) + v.t(); });
show("array", () => { const v: any = new SubArrow([1, 2]); return v.h(2) + v.t() + v.length; });
show("function", () => { const v: any = new SubArrow(function () {}); return v.h(2) + v.t() + typeof v; });
show("proxy", () => { const v: any = new SubArrow(new Proxy({}, {})); return v.h(2) + v.t(); });
show("other-instance", () => { const v: any = new SubArrow(new Other()); return v.h(2) + v.t() + v.o + (v instanceof Other); });
show("same-class", () => { const first = new SubArrow(null); const v: any = new SubArrow(first); return (v === first) + "" + v.h(2) + v.m(); });
show("frozen", () => new SubArrow(Object.freeze({})));
show("new-target", () => { const v: any = Reflect.construct(SubArrow, [null], Other); return v.h(2) + v.t() + (v instanceof Other) + (v instanceof SubArrow) + typeof v.m; });
show("new-target-fn", () => { const v: any = Reflect.construct(SubArrow, [null], function () {}); return v.h(2) + v.t() + typeof v.m; });
show("new-target-base", () => { const v: any = Reflect.construct(Ret, [null], SubArrow); return typeof v.h + v.m(); });
show("new-target-proto-null", () => { function N() {} N.prototype = null as any; const v: any = Reflect.construct(SubArrow, [null], N); return v.h(2) + (Object.getPrototypeOf(v) === Object.prototype); });
function make(tag: string) { return class K { t = tag; m(): string { return this.t + "!"; } a = (): string => this.t + "?"; }; }
const KA = make("a"), KB = make("b");
show("factory", () => new KA().m() + new KB().m() + new KA().a());
show("factory-cross", () => KA.prototype.m.call(new KB()) + (new KA() instanceof KB));
show("factory-new-target", () => { const v: any = Reflect.construct(KA, [], KB); return v.m() + v.a() + (v instanceof KB); });
const Mix = (Base: any) => class extends Base { z = 1; getZ(): number { return this.z + 1; } az = (): number => this.z * 2; };
show("mixin-object", () => { const v = new (Mix(Object))(); return v.getZ() + v.az(); });
show("mixin-array", () => { const v: any = new (Mix(Array) as any)(3); return v.getZ() + v.az() + v.length; });
show("mixin-map", () => { const v: any = new (Mix(Map) as any)([[1, 2]]); return v.getZ() + v.az() + v.size; });
show("mixin-returns", () => { const v: any = new (Mix(class { constructor() { return [9]; } }))(); return v.getZ === undefined ? "no method" + v.az() + v.z : "method"; });
show("mixin-es5", () => { function Old(this: any) { this.old = 1; } const v: any = new (Mix(Old))(); return v.getZ() + v.az() + v.old; });
show("mixin-twice", () => { const v: any = new (Mix(Mix(Object)))(); return v.getZ() + v.az(); });
show("mixin-null", () => new (Mix(null))());
class Swapped { v = 1; get(): number { return this.v; } }
class Parent1 { p = "one"; }
class Parent2 { p = 2; q = []; constructor() { return { fake: true } as any; } }
class Child extends Parent1 { c = 3; sum(): string { return this.p + this.c; } }
show("child", () => new Child().sum());
Object.setPrototypeOf(Child, Parent2);
show("child-swapped", () => { const v: any = new Child(); return JSON.stringify(v) + typeof v.sum; });
Object.setPrototypeOf(Child, Swapped);
show("child-swapped-2", () => { const v: any = new Child(); return JSON.stringify(v) + v.sum(); });
