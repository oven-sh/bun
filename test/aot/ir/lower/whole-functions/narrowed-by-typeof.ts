// RUN: lower

export function describe(value: string | number): string {
  if (typeof value === "string") return value;
  return value.toFixed(2);
}

// GENERATED: describe
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: v1 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = NarrowByTest v0, v5
// CHECK-NEXT: v7 = PropGet v6 key="toFixed"
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeKey="toFixed" calleeName="value.toFixed"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
