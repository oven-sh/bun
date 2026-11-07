// RUN: lower
// OPTIONS: builtin-modules

// Literals that leave typed code as what a closure returns, what a getter returns, a default of a parameter, an initializer of a field, and what a generator yields, each of type `unknown`.
const fromClosure = ((): unknown => ({ count: 1, more: { n: 1, extra: "e" } }))();
const fromGetter = {
  get k(): unknown {
    return { count: 2, more: { n: 2, extra: "f" } };
  },
}.k;
const fromDefault = ((x: unknown = { count: 3, more: { n: 3, extra: "g" } }) => x)();
class Keeper {
  held: unknown = { count: 4, more: { n: 4, extra: "h" } };
}
function* each(): Generator<unknown> {
  yield { count: 5, more: { n: 5, extra: "i" } };
}
for (const o of [fromClosure, fromGetter, fromDefault, new Keeper().held, ...each()] as any[]) {
  o.more = { n: 10 };
  o.count = "many";
  console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
}

// GENERATED: each Keeper k
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Data data=[[d_1]]
// CHECK-NEXT: v4 = Yield v3
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Switch v6 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v5
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b4():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keeper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="k"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_4]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
