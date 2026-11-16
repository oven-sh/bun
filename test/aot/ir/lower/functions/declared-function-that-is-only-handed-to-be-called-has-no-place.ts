// RUN: lower
// CHECK: function [[add]] name="add"
// CHECK-LABEL: function {{*}}name="each"
// CHECK-NOT: testedType=undefined|null
// CHECK: = NewClosure {{*}}function=[[add]]
// CHECK: = CallDirect
// CHECK-NOT: testedType=undefined|null
// CHECK: = NewClosure {{*}}function=[[add]]
// CHECK: = CallDirect

export function outer(list: number[]): number {
  let sum = 0;
  function once(value: number, action: (x: number) => number) {
    return action(value);
  }
  function add(x: number) {
    sum += x;
    return sum;
  }
  function each() {
    for (const x of list) once(x, add);
    return once(1, add);
  }
  return each();
}
