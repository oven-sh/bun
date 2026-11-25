// RUN: lower
// RUN(ERASED): lower
// OPTIONS(ERASED): erase-types

export function twice(n: number): number {
  return n * 2;
}

// GENERATED: twice
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// ERASED-LABEL: function {{*}}name="twice"
// ERASED: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// ERASED-NEXT: b0(v0: number):
// ERASED-NEXT: v1 = Integer integer=2
// ERASED-NEXT: v2 = Mul v0, v1
// ERASED-NEXT: Return v2
// ERASED-NEXT: }
