// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK-NOT: PropDefine
// CHECK: [[head]] = NewObject -, [[a]], [[b]] layout={{*}}fields=[0, 1]
// CHECK-NEXT: = FinishObject [[head]]
// CHECK-NOT: PropDefine
// CHECK: Return

export function create(x: number, y: string) {
  return { a: x, b: y };
}
