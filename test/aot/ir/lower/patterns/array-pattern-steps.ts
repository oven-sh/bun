// RUN: lower
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: [[called]] = Call {{*}}calleeName="pair"
// CHECK-NEXT: [[iterable]] = Convert [[called]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: [[iterator]] = IteratorOpen [[iterable]] elementCount=2 [isDestructuring]
// CHECK: = IteratorResume [[iterator]] stepIndex=0
// CHECK: = IteratorResume [[iterator]] stepIndex=1
// CHECK: IteratorClose [[iterator]] @

// RUN(LANDING): lower
// LANDING: [[iterator]] = IteratorOpen
// LANDING: role=IterationCleanup subject=[[iterator]]
// LANDING-NEXT: [[exception]] = CatchException
// LANDING-NEXT: IteratorClose [[iterator]] completion=Throw
// LANDING-NEXT: Rethrow [[exception]]

// RUN(STEPS): lower
// STEPS-COUNT-2: = IteratorResume
// STEPS-NOT: = IteratorResume

// RUN(NOWHERE): lower
// NOWHERE-NOT: DestructureIterable
// NOWHERE-NOT: @@iterator
// NOWHERE-NOT: key="next"
// NOWHERE-NOT: ElemGet

export function steps(pair: any) {
  const [a, b] = pair();
  return a + b;
}
