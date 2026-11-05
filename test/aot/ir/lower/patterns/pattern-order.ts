// RUN: lower
// CHECK-LABEL: function {{*}}name="arrayOrder"
// CHECK-NOT: = Call
// CHECK: [[calledIterable]] = Call {{*}}calleeName="v"
// CHECK-NEXT: [[iterable]] = Convert [[calledIterable]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: [[iterator]] = IteratorOpen [[iterable]]
// CHECK-NOT: IteratorResume
// CHECK: [[called]] = Call {{*}}calleeName="o"
// CHECK-NEXT: [[element]] = Convert [[called]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NOT: = Call
// CHECK: = IteratorResume [[iterator]]
// CHECK-NOT: PropSet
// CHECK: = Call {{*}}calleeName="d"
// CHECK-NOT: = Call
// CHECK: PropSet [[element]], {{*}}key="p"
// CHECK-LABEL: function {{*}}name="objectOrder"
// CHECK-NOT: = Call
// CHECK: = Call {{*}}calleeName="v"
// CHECK-NOT: = Call
// CHECK: [[calledKey]] = Call {{*}}calleeName="k"
// CHECK-NOT: = Call
// CHECK: [[key]] = ToPropertyKey [[calledKey]]
// CHECK-NOT: ElemGet
// CHECK: [[calledHolder]] = Call {{*}}calleeName="o"
// CHECK-NEXT: [[holder]] = Convert [[calledHolder]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NOT: = Call
// CHECK: = ElemGet [[object]], [[key]]
// CHECK-NOT: PropSet
// CHECK: = Call {{*}}calleeName="d"
// CHECK-NOT: = Call
// CHECK: PropSet [[holder]], {{*}}key="p"

export function arrayOrder(v: any, o: any, d: any) {
  [o().p = d()] = v();
}

export function objectOrder(v: any, k: any, o: any, d: any) {
  ({ [k()]: o().p = d() } = v());
}
