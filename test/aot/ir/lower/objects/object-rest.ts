// RUN: lower
// CHECK-LABEL: function {{*}}name="split"
// CHECK: [[key]] = ToPropertyKey
// CHECK: = CopyObject [[source]], [[key]] excludedKeys=["a"]

// RUN(PLAIN): lower
// PLAIN-LABEL: function {{*}}name="pick"
// PLAIN-NOT: = NewObject
// PLAIN-NOT: CopyDataProperties
// PLAIN-NOT: CopyObject
// PLAIN: Return

export function split(o: Record<string, unknown>, k: string) {
  const { a, [k]: b, ...rest } = o;
  return [a, b, rest];
}

export function pick(o: Record<string, unknown>) {
  const { a } = o;
  return a;
}
