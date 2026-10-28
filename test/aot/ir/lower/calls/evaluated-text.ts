// RUN: lower
// CHECK-LABEL: function {{*}}name="call"
// CHECK: [[callExpected]] = Builtin builtin=Function
// CHECK-NEXT: [[callTest]] = StrictEq [[callCallee]], [[callExpected]]
// CHECK-NEXT: Branch [[callTest]] -> taken [[callCompiled]](), notTaken [[callOrdinary]](
// CHECK: [[callCompiled]]():
// CHECK-NEXT: = NewClosure function=f
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: [[constructExpected]] = Builtin builtin=Function
// CHECK-NEXT: [[constructTest]] = StrictEq [[constructCallee]], [[constructExpected]]
// CHECK-NEXT: Branch [[constructTest]] -> taken [[constructCompiled]](), notTaken [[constructOrdinary]](
// CHECK: [[constructCompiled]]():
// CHECK-NEXT: = NewClosure function=f
// CHECK-LABEL: function {{*}}name="dynamicText"
// CHECK-NOT: StrictEq
// CHECK-COUNT-1: = Call
// CHECK-NOT: StrictEq
// CHECK-NOT: = Call
// CHECK-LABEL: function {{*}}name="indirect"
// CHECK: [[indirectExpected]] = Builtin builtin=Eval
// CHECK-NEXT: [[indirectTest]] = StrictEq [[indirectCallee]], [[indirectExpected]]
// CHECK-NEXT: Branch [[indirectTest]] -> taken [[indirectCompiled]](), notTaken [[indirectOrdinary]](
// CHECK: [[indirectCompiled]]():
// CHECK-NEXT: [[script]] = NewClosure function=f
// CHECK-NEXT: = Call [[script]]

// RUN(ORDINARY): lower
// ORDINARY-LABEL: function {{*}}name="call"
// ORDINARY: Branch {{*}}notTaken [[callOrdinary]](| 0)
// ORDINARY: [[callOrdinary]]([[callOther]]):
// ORDINARY-NEXT: = Call [[callOther]], {{*}}calleeName="Function"
// ORDINARY-LABEL: function {{*}}name="construct"
// ORDINARY: Branch {{*}}notTaken [[constructOrdinary]](| 0)
// ORDINARY: [[constructOrdinary]]([[constructOther]]):
// ORDINARY-NEXT: = Construct [[constructOther]], {{*}}calleeName="Function"
// ORDINARY-LABEL: function {{*}}name="indirect"
// ORDINARY: Branch {{*}}notTaken [[indirectOrdinary]](| 0)
// ORDINARY: [[indirectOrdinary]]([[indirectOther]]):
// ORDINARY-NEXT: = Call [[indirectOther]],

export function call() {
  return Function("a", "return a");
}

export function construct() {
  return new Function("return 1");
}

export function dynamicText(text: string) {
  return Function(text);
}

export function indirect() {
  return (0, eval)("1 + 1");
}
