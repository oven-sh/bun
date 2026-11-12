// RUN: lower
// CHECK-LABEL: function {{*}}name="m"
// CHECK: thisType={type=[[layout]]}
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

// A method has its body once reached code reads its name.
export function readsTheNames(o: any) { return [o.m]; }
