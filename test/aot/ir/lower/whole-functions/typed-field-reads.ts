// RUN: lower

class Rectangle {
  constructor(
    public width: number,
    public height: number,
  ) {}
}
export function area(r: Rectangle): number {
  return r.width * r.height;
}

// GENERATED: area
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = PropGet v0 key="height"
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
