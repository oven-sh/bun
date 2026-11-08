// RUN: lower
// CHECK-LABEL: function {{*}}name="defaulted"
// CHECK-NOT: handler=
// CHECK: ([[v]]: anything, [[f]]: anything):
// CHECK-NOT: handler=
// CHECK: [[iterator]] = IteratorOpen
// CHECK: handler=[[landing]]():
// CHECK-NEXT: = IteratorResume [[iterator]] stepIndex=0
// CHECK: [[default]]({{*}}) handler=[[landing]]():
// CHECK-NEXT: = Call [[f]] calleeName="f"
// CHECK: IteratorClose [[iterator]] @
// CHECK: [[landing]]() role=IterationCleanup subject=[[iterator]]:
// CHECK: IteratorClose [[iterator]] completion=Throw
// CHECK-LABEL: function {{*}}name="empty"
// CHECK-NOT: handler=
// CHECK: [[emptyIterator]] = IteratorOpen {{*}}elementCount=0 [isDestructuring]
// CHECK-NOT: IteratorResume
// CHECK: IteratorClose [[emptyIterator]] @
// CHECK-NOT: IteratorResume
// CHECK-LABEL: function {{*}}name="member"
// CHECK-NOT: handler=
// CHECK: [[memberIterator]] = IteratorOpen
// CHECK: handler=[[memberLanding]]():
// CHECK-NEXT: [[object]] = Call {{*}}calleeName="o"
// CHECK-NEXT: = IteratorResume [[memberIterator]] stepIndex=0
// CHECK: PropSet [[object]], {{*}}key="p"
// CHECK: IteratorClose [[memberIterator]] @
// CHECK: [[memberLanding]]() role=IterationCleanup subject=[[memberIterator]]:
// CHECK: IteratorClose [[memberIterator]] completion=Throw

// RUN(FLAGS): lower
// FLAGS-NOT: = Boolean

// RUN(BRANCHES): lower
// BRANCHES-LABEL: function {{*}}name="member"
// BRANCHES-NOT: Branch

// RUN(CLOSES): lower
// CLOSES-LABEL: function {{*}}name="member"
// CLOSES-COUNT-2: IteratorClose
// CLOSES-NOT: IteratorClose

export function defaulted(v: any, f: any) {
  let a: any;
  [a = f()] = v;
  return a;
}

export function empty(v: any) {
  [] = v;
}

export function member(v: any, o: any) {
  [o().p] = v;
}
