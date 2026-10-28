// RUN: lower
// CHECK-LABEL: function {{*}}name="m"
// CHECK: thisType={type=[[layout]] site=w{{*}}}
// CHECK: ([[this]]: [[layout]]):
// CHECK-NOT: Convert
// CHECK-COUNT-2: = PropGet [[this]] key="x"
// CHECK-NOT: Convert [[this]]
// CHECK: Return

export class C {
  x = 1;
  m() {
    return this.x + this.x;
  }
}
