// RUN: lower
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: Branch
// CHECK: Return
// CHECK: [[scope]] = NewObject layout=[[layout]]
// CHECK: PutEnvironmentField [[scope]],
// CHECK: = NewClosure [[scope]] function=

export function pick(list: number[], quick: boolean): number {
  if (quick) return 0;
  let sum = 0;
  list.forEach(n => {
    sum += n;
  });
  return sum;
}
