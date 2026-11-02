// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: p ParamOver c1 base2 ag
// CHECK-LABEL: function {{*}}name="p"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_2]]} results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_1]] field=2
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ParamOver"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_5]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1 layout=[[L_7]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_8]]
// CHECK-NEXT: PropSet v6, v2 key="v"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: Jump -> next b8(v13)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = TypeTest v14 testedType=undefined
// CHECK-NEXT: Branch v15 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v17 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v18) frequency=Unlikely:
// CHECK-NEXT: v19 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v19
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b8(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Return v21
// CHECK-NEXT: b9(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=DerivedConstructorResult name="ParamOver"
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b10(v24) frequency=Unlikely:
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, IsNamedByComputedKey] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="base2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_10]] site=[[w_11]]} results=[{type=boolean site=[[w_12]]}] {
// CHECK-NEXT: b0(v0: [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="toString"
// CHECK-NEXT: v4 = Builtin builtin=ObjectPrototypeToString
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=[[L_14]] site=[[w_15]]} results=[{type=undefined|null|AsyncGenerator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_14]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=5
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_16]]}
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
