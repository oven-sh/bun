// RUN: lower
// OPTIONS: builtin-modules

// `{ a, ...(condition && { c }), d }`: whoever reads the object finds `c` where the condition held and nothing where it did not, whatever the values are and whoever reads: in place, in another function,
// by name, by key, by a walk over the keys, behind a default, and in objects that never leave the function that makes them.
const lines: string[] = [];
const show = (name: string, value: unknown) => void lines.push(name + " | " + JSON.stringify(value) + (value && typeof value === "object" ? " | " + Reflect.ownKeys(value).map(String).join(",") : ""));
let ticks = 0;
const tick = <T>(value: T): T => { ticks++; lines.push("tick " + ticks + " " + String(value)); return value; };

type Made = { a: number; b: number; c?: number; d: number };
function number(i: number, extra: boolean): Made { return { a: i, b: 2, ...(extra && { c: i }), d: 4 }; }
function sums(n: number): string {
  let a = 0, c = 0, d = 0, has = 0, keys = 0;
  for (let i = 0; i < n; i++) {
    const made = number(i, (i & 3) === 0);
    a += made.a; c += made.c ?? 1; d += made.d; has += "c" in made ? 1 : 0; keys += Object.keys(made).length;
  }
  return [a, c, d, has, keys].join(" ");
}
show("sums", sums(10));
show("large numbers", [number(2 ** 31, true), number(2 ** 53, true), number(0.5, true), number(-0, true), number(NaN, true), number(1, false)]);

type Texts = { name: string; model?: string; note?: string; last: boolean };
function texts(model: string | undefined, note: string | null): Texts { return { name: "n", ...(model && { model }), ...(note && { note }), last: true }; }
show("texts", [texts("m", "x"), texts("", ""), texts(undefined, null), texts("m", null), texts("", "x")]);
function lengths(list: (string | undefined)[]): number { let sum = 0; for (const model of list) sum += texts(model, null).model?.length ?? 100; return sum; }
show("lengths", lengths(["ab", "", undefined, "c"]));

function either(flag: boolean, i: number) { return { first: 1, ...(flag ? { yes: i, both: "y" } : { no: i, both: "n" }), last: 2 }; }
show("either", [either(true, 1), either(false, 2)]);
function chain(which: number) { return { ...(which === 0 ? { zero: 0 } : which === 1 ? { one: 1 } : which === 2 ? {} : { many: which }), end: true }; }
show("chain", [chain(0), chain(1), chain(2), chain(3)]);
function nested(a: boolean, b: boolean) { return { x: 1, ...(a && { y: 2, ...(b && { z: 3 }), w: 4 }), v: 5 }; }
show("nested", [nested(true, true), nested(true, false), nested(false, true)]);
function otherArm(flag: boolean, other: object | undefined) { return { x: 1, ...(flag ? { y: 2 } : other), z: 3 }; }
show("another arm", [otherArm(true, { q: 1 }), otherArm(false, { q: 1, x: 9 }), otherArm(false, "ab" as unknown as object), otherArm(false, undefined)]);

show("replaces", ((on: boolean) => ({ a: 1, b: 2, ...(on && { a: 10 }), c: 3 }))(true));
show("is replaced", ((on: boolean) => ({ ...(on && { a: 10, b: 20 }), a: 1 }))(true));
show("order of computing", { p: tick("p"), ...(tick(true) && { q: tick("q"), r: tick("r") }), ...((tick(0) as unknown as boolean) && { never: tick("never") }), s: tick("s") });
show("falsy of every kind", [0, -0, NaN, "", null, undefined, false, 0n].map(value => Object.keys({ a: 1, ...((value as unknown as boolean) && { b: 2 }) }).join()));
show("truthy of every kind", [1, "x", {}, [], () => 0, Symbol.iterator, 1n].map(value => Object.keys({ a: 1, ...((value as unknown as boolean) && { b: 2 }) }).join()));

const functions = ((on: boolean) => ({ ...(on && { named: () => 1, other: function () { return 2; }, klass: class {} }) }))(true) as Record<string, { name: string }>;
show("names of functions", [functions.named.name, functions.other.name, functions.klass.name]);

const above = { set inherited(value: string) { lines.push("THE SETTER RAN " + value); }, get inherited() { return "from above"; } };
const below = (on: boolean) => ({ __proto__: above, a: 1, ...(on && { inherited: "own" }) }) as { a: number; inherited?: string };
const shadows = below(true), inherits = below(false);
show("under a setter above", [shadows, shadows.inherited, Object.hasOwn(shadows, "inherited"), inherits, inherits.inherited, Object.hasOwn(inherits, "inherited")]);

type Attributes = Record<string, string | number | boolean | undefined>;
function attributes(user?: string, size?: number, fast?: boolean): Attributes {
  return { "app.name": "x", ...(user && { "user.id": user }), ...(size !== undefined && { "request.size": size, "request.known": true }), ...(fast && { "request.fast": true }), "app.end": 1 };
}
show("attributes", [attributes(), attributes("u"), attributes("", 0), attributes("u", 2 ** 40, true)]);

function throws(on: boolean) { try { return { a: 1, ...(on && { b: (() => { throw new Error("in the literal"); })() }), c: 3 }; } catch (error) { return (error as Error).message; } }
show("a value that throws", [throws(true), throws(false)]);
async function awaits(on: boolean) { return { a: 1, ...(on && { b: await Promise.resolve(2) }), ...((await Promise.resolve(on)) && { c: 3 }), d: 4 }; }
function* yields(on: boolean): Generator<number, object, number> { return { a: 1, ...(on && { b: yield 1 }), c: yield 2 }; }
const stepped = yields(true); stepped.next(); stepped.next(20);
show("a generator", stepped.next(30).value);
const frozen = Object.freeze({ a: 1, ...(ticks > 0 && { b: 2 }) });
show("frozen", [frozen, Object.isFrozen(frozen)]);
class Holder { made = { a: 1, ...(ticks > 0 && { b: this.constructor.name }) }; static also = { ...(ticks > 0 ? { c: "static" } : { d: 0 }) }; }
show("in a class", [new Holder().made, Holder.also]);
Promise.all([awaits(true), awaits(false)]).then(values => { show("awaits", values); console.log(lines.join("\n")); });

// GENERATED: yields inherited Holder named
// CHECK-LABEL: function {{*}}name="yields"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_1]]}] results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: v6 = NewObject -, v5 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = ToBoolean v2
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b7(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v12 = Yield v11, v9
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v13
// CHECK-NEXT: b6():
// CHECK-NEXT: v15 = Convert v13 declared={type=undefined|number}
// CHECK-NEXT: PropDefine v7, v15 key="b"
// CHECK-NEXT: Jump -> next b8(v9)
// CHECK-NEXT: b7(v17):
// CHECK-NEXT: Jump -> next b8(v17)
// CHECK-NEXT: b8(v18: boolean):
// CHECK-NEXT: v19 = Integer integer=2
// CHECK-NEXT: v20 = Convert v19 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v21 = Yield v20, v18
// CHECK-NEXT: v22 = ResultAt v21
// CHECK-NEXT: v23 = ResultAt v21 index=1
// CHECK-NEXT: Switch v23 cases=[1, 2] -> case b9(), case b10(), otherwise b11()
// CHECK-NEXT: b9():
// CHECK-NEXT: Throw v22
// CHECK-NEXT: b10():
// CHECK-NEXT: Return v22
// CHECK-NEXT: b11():
// CHECK-NEXT: v24 = Convert v22 declared={type=number}
// CHECK-NEXT: PropDefine v7, v24 key="c"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inherited"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="lines"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="THE SETTER RAN "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inherited"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="from above"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_9]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_10]]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
