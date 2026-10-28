// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK: b0([[x]]
// CHECK-NOT: isFreeName
// CHECK: = NewObject -, [[x]] layout={{*}}fields=[0]

export function create(x: unknown) {
  return { x };
}
