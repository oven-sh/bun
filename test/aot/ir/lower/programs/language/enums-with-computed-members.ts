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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="order"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeKey="push" calleeName="order.push"
// CHECK-NEXT: v6 = Convert v5 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Convert v1 declared={type=number}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="local"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = NewObject layout=[[L_2]]
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
// CHECK-NEXT: v14 = PropGet v2 key="Twice"
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: PropSet v2, v15 key="Both"
// CHECK-NEXT: v17 = ToPropertyKey v15
// CHECK-NEXT: v18 = String string="Both"
// CHECK-NEXT: ElemSet v2, v17, v18
// CHECK-NEXT: v20 = PropGet v2 key="Seed"
// CHECK-NEXT: v21 = PropGet v2 key="Twice"
// CHECK-NEXT: v22 = PropGet v2 key="Both"
// CHECK-NEXT: v23 = Integer integer=3
// CHECK-NEXT: v24 = Mul v0, v23
// CHECK-NEXT: v25 = ElemGet v2, v24
// CHECK-NEXT: v26 = NewArray v20, v21, v22, v25 contents=anything
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
