// RUN: lower
// CHECK-LABEL: function {{*}}name="binding"
// CHECK-NEXT: ([[v]]: {{*}}, [[k]]:
// CHECK: Branch {{*}}notTaken [[present]](| 0)
// CHECK: [[present]]([[o]]):
// CHECK: = PropGet [[o]] key="a"
// CHECK: [[key]] = ToPropertyKey [[k]]
// CHECK: = ElemGet [[o]], [[key]]
// CHECK: = CopyObject [[o]], [[key]] excludedKeys=["a"]
// CHECK-LABEL: function {{*}}name="memberRest"
// CHECK-NOT: CopyObject
// CHECK: [[holder]] = Call {{*}}calleeName="o"
// CHECK: [[rest]] = CopyObject [[source]] @
// CHECK: PropSet [[holder]], [[rest]] key="p"

export function binding(v: any, k: any) {
  const { a, [k]: b, ...rest } = v;
  return [a, b, rest];
}

export function memberRest(v: any, o: any) {
  ({ ...o().p } = v);
}
