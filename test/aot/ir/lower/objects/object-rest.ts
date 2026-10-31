// RUN: lower
// CHECK-LABEL: function {{*}}name="split"
// CHECK: [[key]] = ToPropertyKey
// CHECK: [[head]] = NewObject layout=[[layout]] @
// CHECK-NEXT: CopyDataProperties [[head]], [[source]], [[key]] excludedKeys=["a"]
// CHECK-NEXT: = FinishObject [[head]]

// RUN(PLAIN): lower
// PLAIN-LABEL: function {{*}}name="pick"
// PLAIN-NOT: = NewObject
// PLAIN-NOT: CopyDataProperties
// PLAIN: Return

export function split(o: Record<string, unknown>, k: string) {
  const { a, [k]: b, ...rest } = o;
  return [a, b, rest];
}

export function pick(o: Record<string, unknown>) {
  const { a } = o;
  return a;
}
