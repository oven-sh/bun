// RUN: lower
// OPTIONS: builtin-modules

const order: string[] = [];
function noted(name: string, value: number): number {
  order.push(name);
  return value;
}
order.push("ahead");
enum Sizes {
  None,
  Small = "abc".length,
  Large = noted("Large", 7) * 2,
  Larger = Large + Small,
  Fixed = 100,
}
order.push("behind");
console.log(order.join());
console.log(Sizes.None, Sizes.Small, Sizes.Large, Sizes.Larger, Sizes.Fixed);
console.log(Sizes[3], Sizes[14], Sizes[17], Sizes[100], Sizes[0]);
console.log(Object.keys(Sizes).join());

function sum(a: Sizes, b: Sizes): number {
  return a + b;
}
console.log(sum(Sizes.Large, Sizes.Fixed), sum(Sizes.Small, Sizes.None));

export enum Exported {
  First = Math.max(1, 2),
  Second = First << 2,
}
console.log(Exported.First, Exported.Second, Exported[8]);

function local(seed: number) {
  enum Local {
    Seed = seed,
    Twice = seed * 2,
    Both = Seed + Twice,
  }
  return [Local.Seed, Local.Twice, Local.Both, Local[seed * 3]];
}
console.log(local(2).join(), local(5).join());

enum Merged {
  A = 1,
}
enum Merged {
  B = noted("B", 40) + 2,
}
console.log(Merged.A, Merged.B, Merged[42], order.join());

namespace Inner {
  export enum Flags {
    Read = 1 << 0,
    Write = noted("Write", 2),
    Both = Read | Write,
  }
}
console.log(Inner.Flags.Read, Inner.Flags.Write, Inner.Flags.Both, Inner.Flags[3]);

function pick(): Sizes {
  return Sizes.Larger;
}
switch (pick()) {
  case Sizes.Small:
    console.log("small");
    break;
  case Sizes.Larger:
    console.log("larger");
    break;
}
const fraction: Record<string, unknown> = {};
enum Odd {
  Half = 1 / noted("Half", 2),
  NotANumber = 0 / noted("NotANumber", 0),
  Negative = -noted("Negative", 1),
}
fraction.keys = Object.keys(Odd).join();
console.log(Odd.Half, Odd.NotANumber, Odd.Negative, Odd[0.5], Odd["NaN"], Odd[-1], fraction.keys);

// GENERATED: noted local
// CHECK-LABEL: function {{*}}name="noted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_2]]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="order"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeKey="push" calleeName="order.push"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Convert v1 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="local"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_6]]}] results=[{type=undefined|null|Array<undefined|null|number|string> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_8]]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: PropSet v2, v0 key="Seed"
// CHECK-NEXT: v4 = ToPropertyKey v0
// CHECK-NEXT: v5 = String string="Seed"
// CHECK-NEXT: ElemSet v2, v4, v5
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Mul v0, v7
// CHECK-NEXT: PropSet v2, v8 key="Twice"
// CHECK-NEXT: v10 = ToPropertyKey v8
// CHECK-NEXT: v11 = String string="Twice"
// CHECK-NEXT: ElemSet v2, v10, v11
// CHECK-NEXT: v13 = PropGet v2 key="Seed"
// CHECK-NEXT: v14 = Convert v13 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v15 = PropGet v2 key="Twice"
// CHECK-NEXT: v16 = Convert v15 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v17 = Add v14, v16
// CHECK-NEXT: PropSet v2, v17 key="Both"
// CHECK-NEXT: v19 = ToPropertyKey v17
// CHECK-NEXT: v20 = String string="Both"
// CHECK-NEXT: ElemSet v2, v19, v20
// CHECK-NEXT: v22 = Convert v2 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v23 = PropGet v22 key="Seed"
// CHECK-NEXT: v24 = Convert v23 declared={type=number site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v25 = PropGet v22 key="Twice"
// CHECK-NEXT: v26 = Convert v25 declared={type=number site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v27 = PropGet v22 key="Both"
// CHECK-NEXT: v28 = Convert v27 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = Integer integer=3
// CHECK-NEXT: v30 = Mul v0, v29
// CHECK-NEXT: v31 = ElemGet v22, v30
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v33 = NewArray v24, v26, v28, v32 contents=undefined|null|number|string
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|Array<undefined|null|number|string> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
