// RUN: lower
// RUN(ERASED): lower
// OPTIONS(ERASED): erase-types

export function twice(n: number): number {
  return n * 2;
}

// GENERATED: twice
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// ERASED-LABEL: function {{*}}name="twice"
// ERASED: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// ERASED-NEXT: b0(v0: number):
// ERASED-NEXT: Jump -> next b1()
// ERASED-NEXT: b1():
// ERASED-NEXT: v1 = Integer integer=2
// ERASED-NEXT: v2 = Mul v0, v1
// ERASED-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// ERASED-NEXT: Return v3
// ERASED-NEXT: }
