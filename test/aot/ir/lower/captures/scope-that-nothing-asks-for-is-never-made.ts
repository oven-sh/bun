// RUN: lower
// CHECK-LABEL: function {{*}}name="arm"
// CHECK: PropGet {{*}}key="length"
// CHECK: [[scope]] = NewObject
// CHECK: Branch
// CHECK: PutEnvironmentField [[scope]],
// CHECK: = NewClosure [[scope]] function=
// CHECK-LABEL: function {{*}}name="idle"
// CHECK-NOT: NewObject

export function arm(flag: boolean, count: number, name: string): () => number {
  const size = name.length;
  if (flag) count = count + size;
  return () => count++;
}

export function idle(seed: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const never = () => {
    seed++;
  };
  return work;
}
