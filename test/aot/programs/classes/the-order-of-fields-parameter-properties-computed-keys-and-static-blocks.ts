// In which order a class evaluates computed keys, static blocks, field initializers, parameter properties and constructor bodies, and what each form of member leaves on the instance, the prototype and the class.
function show(label: string, f: () => unknown) {
    try { console.log(label, JSON.stringify(f())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name, (e as Error).message); }
}
const log: string[] = []; const L = <T>(s: string, v: T): T => { log.push(s); return v; };
const flush = () => log.splice(0).join(",");
// parameter properties, field order
// @ts-ignore
class PP { a = L("a", 1); constructor(public x: number, private y = L("y-default", 2), readonly z?: string, protected w: number = x + 1) { L("body", 0); this.b = x; } b: number = L("b", 3); c = L("c", this.x); }
show("parameter properties", () => [new PP(10), Object.keys(new PP(10)), flush()]);
class PPBase { constructor(public base: string) { L("base-ctor", 0); } }
// @ts-ignore
class PPDerived extends PPBase { f = L("f", this.base); constructor(public own: number) { L("before-super", 0); super(L("super-arg", "s")); L("after-super", 0); } g = L("g", this.own); }
show("derived parameter properties", () => [new PPDerived(1), Object.keys(new PPDerived(1)), flush()]);
// @ts-ignore
class Keys { [L("k1", "p")] = L("v1", 1); static [L("k2", "q")] = L("v2", 2); [L("k3", "m")]() {} static { L("static-block", 0); } [L("k4", "r")] = L("v4", 4); static s2 = L("s2", 5); }
show("computed keys order", () => { const before = flush(); new Keys(); return [before, flush(), Object.keys(new Keys()), Object.keys(Keys)]; });
// @ts-ignore
class NoInit { x: number; y?: string; z!: boolean; declare d: number; static s: number; constructor() { } }
show("fields without initializers", () => [Object.keys(new NoInit()), "x" in new NoInit(), Object.keys(NoInit), Object.getOwnPropertyDescriptor(new NoInit(), "x")]);
class SetterBase { set v(x: number) { L("setter " + x, 0); } get v() { return -1; } }
// @ts-ignore
class FieldOver extends SetterBase { v = 5; }
show("field defines over setter", () => [new FieldOver().v, flush(), Object.getOwnPropertyDescriptor(new FieldOver(), "v")]);
// @ts-ignore
class FieldOverNoInit extends SetterBase { v: number; constructor() { super(); } }
show("uninitialized field over accessor", () => [new FieldOverNoInit().v, Object.keys(new FieldOverNoInit())]);
// @ts-ignore
class ParamOver extends SetterBase { constructor(public v: number) { super(); } }
show("parameter property over setter", () => [new ParamOver(3).v, flush(), Object.keys(new ParamOver(3))]);
class Arrow { n = 1; f = () => this.n; static sf = () => this.name; g = function (this: unknown) { return typeof this; }; }
show("arrow fields", () => { const a = new Arrow(); const { f, g } = a; return [f(), Arrow.sf(), g()]; });
class Acc { accessor a = L("acc-init", 1); static accessor s = 2; accessor #p = 3; get p() { return this.#p; } }
show("auto accessors", () => { const a = new Acc(); a.a++; Acc.s += 5; return [a.a, Acc.s, a.p, Object.keys(a), Object.getOwnPropertyNames(Acc.prototype), flush()]; });
abstract class Abs { abstract x: number; abstract m(): number; y = L("abs-y", 1); n() { return this.m() + this.x; } }
class Conc extends Abs { x = 2; m() { return 3; } }
show("abstract", () => [new Conc().n(), Object.keys(new Conc()), Object.getOwnPropertyNames(Abs.prototype), flush()]);
class Ov { m(a: string): string; m(a: number): number; m(a: any) { return a; } constructor(); constructor(a?: number) { } }
show("overloads", () => [new Ov().m(1), Object.getOwnPropertyNames(Ov.prototype), Ov.length]);
class Priv { #a = 1; static #s = 2; #m() { return this.#a; } static has(o: object) { return #a in o; } get #g() { return 5; } read() { return [this.#a, Priv.#s, this.#m(), this.#g]; } private ts = 9; }
show("private names", () => [new Priv().read(), Priv.has(new Priv()), Priv.has({}), Object.keys(new Priv())]);
class StaticThis { static a = 1; static b = this.a + 1; static c = StaticThis.b + 1; static m() { return this.c; } static { this.a = 10; } }
show("static this", () => [StaticThis.a, StaticThis.b, StaticThis.c, StaticThis.m()]);
const Named = class Inner { static self = Inner.name; me() { return Inner; } }; show("class expression name", () => [Named.name, Named.self, new Named().me() === Named]);
const anon = class { }; const o = { k: class { }, f: function () { }, a: () => { }, ["c" + 1]: class { } }; show("inferred names", () => [anon.name, o.k.name, o.f.name, o.a.name, o.c1.name]);
class Ret { x = 1; constructor() { return { other: 2 } as any; } } show("constructor returns", () => new Ret());
class RetD extends Ret { y = 3; } show("derived of returning", () => [new RetD(), new RetD() instanceof RetD]);
class Getter { get [Symbol.toStringTag]() { return "G"; } static get [Symbol.species]() { return Array; } } show("symbol members", () => [String(new Getter()), (Getter as any)[Symbol.species] === Array]);
class SuperProps extends PPBase { constructor() { super("b"); } base2() { return super.toString === Object.prototype.toString; } static sm() { return super.name; } get viaSuper() { return typeof super.constructor; } }
show("super properties", () => [new SuperProps().base2(), SuperProps.sm(), new SuperProps().viaSuper, flush()]);
function mixin<T extends new (...a: any[]) => object>(B: T) { return class extends B { mixed = L("mixed", 1); constructor(...a: any[]) { super(...a); L("mixin-ctor", 0); } }; }
show("mixin", () => [new (mixin(PPBase))("x"), flush(), mixin(PPBase).name]);
class TDZ { static a = (() => { try { return typeof TDZ; } catch (e) { return "tdz"; } })(); } show("class binding in static init", () => TDZ.a);
show("class tdz", () => { const f = () => new Late(); try { f(); } catch (e) { return (e as Error).constructor.name; } class Late { } return "no"; });
class GenM { *g() { yield 1; yield* [2, 3]; } async a() { return 4; } async *ag() { yield 5; } static *[Symbol.iterator]() { yield 6; } } show("generator methods", () => [[...new GenM().g()], [...GenM]]);
// @ts-ignore
class NewTarget { t = new.target === undefined; c: boolean; constructor() { this.c = new.target === NewTarget; } } class NT2 extends NewTarget { } show("new.target", () => [new NewTarget(), new NT2()]);
class Opt { m?(): number; f?: () => number; } show("optional members", () => [new Opt().m?.(), new Opt().f?.(), Object.keys(new Opt())]);
class IndexSig { [k: string]: unknown; a = 1; static [k: string]: unknown; } show("index signatures", () => [Object.keys(new IndexSig()), Object.keys(IndexSig)]);
