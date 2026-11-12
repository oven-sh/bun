// RUN: lower
// CHECK-LABEL: function {{*}}name="arrayOrder"
// CHECK-NOT: = Call
// CHECK: [[iterable]] = Call {{*}}calleeName="v"
// CHECK-NEXT: [[iterator]] = IteratorOpen [[iterable]]
// CHECK-NOT: IteratorResume
// CHECK: [[element]] = Call {{*}}calleeName="o"
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
// CHECK: [[holder]] = Call {{*}}calleeName="o"
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
