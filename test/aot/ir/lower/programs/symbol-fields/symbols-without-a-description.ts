// RUN: lower
// OPTIONS: builtin-modules

// Symbol() and Symbol(undefined) have no description, Symbol("") has an empty one. Each names a field of its own.
export {};

const kBare = Symbol();
const kUndefined = Symbol(undefined);
const kEmpty = Symbol("");
class Three {
  [kBare] = 1;
  [kUndefined] = 2;
  [kEmpty] = 3;
  sum(): number {
    return this[kBare] * 100 + this[kUndefined] * 10 + this[kEmpty];
  }
}
let total = 0;
const three = new Three();
for (let round = 0; round < 300; round++) total += three.sum();
console.log(
  total,
  Object.getOwnPropertySymbols(three)
    .map(key => typeof key.description + String(key))
    .join(),
);

// GENERATED: Three sum
// CHECK-LABEL: function {{*}}name="Three"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_3]]} results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="kBare"
// CHECK-NEXT: v3 = ElemGet v0, v2
// CHECK-NEXT: v4 = Integer integer=100
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="kUndefined"
// CHECK-NEXT: v8 = ElemGet v0, v7
// CHECK-NEXT: v9 = Integer integer=10
// CHECK-NEXT: v10 = Mul v8, v9
// CHECK-NEXT: v11 = Add v5, v10
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="kEmpty"
// CHECK-NEXT: v14 = ElemGet v0, v13
// CHECK-NEXT: v15 = Add v11, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
