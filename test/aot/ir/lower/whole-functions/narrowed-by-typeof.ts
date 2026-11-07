// RUN: lower

export function describe(value: string | number): string {
  if (typeof value === "string") return value;
  return value.toFixed(2);
}

// GENERATED: describe
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = Convert v4 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v6 = PropGet v5 key="toFixed"
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeKey="toFixed" calleeName="value.toFixed"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
