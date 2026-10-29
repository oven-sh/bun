// RUN: lower

export class Counter {
  count = 0;
  step(): number {
    return ++this.count;
  }
  twice(): number {
    this.step();
    return this.step();
  }
}

// GENERATED: twice
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_2]]} results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="step"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="step" calleeName="this.step"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v4 = PropGet v0 key="step"
// CHECK-NEXT: v5 = Call v4, v0 calleeKey="step" calleeName="this.step"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=number site=[[w_5]]}}, {declared={type=number site=[[w_3]]}}]
// CHECK-NEXT: }
