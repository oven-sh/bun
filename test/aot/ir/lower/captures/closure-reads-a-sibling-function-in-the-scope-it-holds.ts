// RUN: lower
// CHECK-LABEL: function {{*}}name="counter"
// CHECK: [[scope]] = NewObject layout=[[layout]]
// CHECK: = NewClosure [[scope]] function=[[current]]
// CHECK: PutEnvironmentField [[scope]], {{*}}layout=[[layout]]
// CHECK: = NewClosure [[scope]] function=
// CHECK-LABEL: function {{*}}name="next"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType

export function counter(): () => () => number {
  let n = 0;
  return next;

  function next(): () => number {
    n++;
    return current;
  }
  function current(): number {
    return n;
  }
}
