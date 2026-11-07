// RUN: lower

export function fold() {
  return [+"12", "0x10" * 1, -" 7 ", +"1e3", +"x"];
}

// GENERATED: fold
// CHECK-LABEL: function {{*}}name="fold"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
