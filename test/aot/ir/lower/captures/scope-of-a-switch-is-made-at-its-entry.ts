// RUN: lower
// CHECK-LABEL: function {{*}}name="choose"
// CHECK: [[scope]] = NewObject layout=[[layout]]
// CHECK: PutEnvironmentField [[scope]],
// CHECK: PutEnvironmentField [[scope]], {{*}}field=1

export function choose(kind: number, keep: (f: () => number) => void): number {
  switch (kind) {
    case 0:
      return 0;
    case 1:
      let first = 1;
      keep(() => first++);
      return first;
    case 2:
      let second = 2;
      keep(() => second++);
      return second;
  }
  return -1;
}
