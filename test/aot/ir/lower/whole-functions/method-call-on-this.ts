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

// A method has its body once reached code reads its name.
export function readsTheNames(o: any) { return [o.twice]; }

// GENERATED: twice
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="step"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="step" calleeName="this.step"
// CHECK-NEXT: v3 = PropGet v0 key="step"
// CHECK-NEXT: v4 = Call v3, v0 calleeKey="step" calleeName="this.step"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=number}}]
// CHECK-NEXT: }
