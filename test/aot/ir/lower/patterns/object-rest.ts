// RUN: lower
// CHECK-LABEL: function {{*}}name="binding"
// CHECK-NEXT: ([[v]]: {{*}}, [[k]]:
// CHECK: Branch {{*}}notTaken [[present]](| 0)
// CHECK: [[present]]([[o]]):
// CHECK: = PropGet [[o]] key="a"
// CHECK: [[key]] = ToPropertyKey [[k]]
// CHECK: = ElemGet [[o]], [[key]]
// CHECK: [[copy]] = NewObject
// CHECK: CopyDataProperties [[copy]], [[o]], [[key]] excludedKeys=["a"]
// CHECK: = FinishObject [[copy]]
// CHECK-LABEL: function {{*}}name="memberRest"
// CHECK-NOT: CopyDataProperties
// CHECK: [[result]] = Call {{*}}calleeName="o"
// CHECK-NEXT: [[holder]] = Convert [[result]] declared={type={{*}}flags=[IsExpected]}
// CHECK: CopyDataProperties [[target]], [[source]] @
// CHECK: [[rest]] = FinishObject [[target]]
// CHECK: PropSet [[holder]], [[rest]] key="p"

export function binding(v: any, k: any) {
  const { a, [k]: b, ...rest } = v;
  return [a, b, rest];
}

export function memberRest(v: any, o: any) {
  ({ ...o().p } = v);
}
