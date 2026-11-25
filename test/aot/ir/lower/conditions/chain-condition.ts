// RUN: lower
// CHECK-LABEL: function {{*}}name="call"
// CHECK-NOT: = Undefined
// CHECK: [[callBase]] = TypeTest [[callA]] testedType=undefined|null @
// CHECK-NEXT: Branch [[callBase]] -> taken {{*}}(), notTaken [[callPresent]](| 0)
// CHECK-NOT: = Undefined
// CHECK: [[callPresent]]([[callObject]]):
// CHECK: [[method]] = PropGet [[callObject]] key="b"
// CHECK-NEXT: [[hasMethod]] = TypeTest [[method]] testedType=undefined|null @
// CHECK-NEXT: Branch [[hasMethod]] -> taken {{*}}(), notTaken [[callable]](| 0)
// CHECK-NOT: = Undefined
// CHECK: [[callable]]([[function]]):
// CHECK: [[result]] = Call [[function]], [[callObject]] calleeKey="b"
// CHECK: [[resultTest]] = ToBoolean [[result]]
// CHECK-NEXT: Branch [[resultTest]] ->
// CHECK-NOT: = Undefined
// CHECK-LABEL: function {{*}}name="member"
// CHECK-NOT: = Undefined
// CHECK: [[memberBase]] = TypeTest [[memberA]] testedType=undefined|null @
// CHECK-NEXT: Branch [[memberBase]] -> taken {{*}}(), notTaken [[memberPresent]](| 0)
// CHECK-NOT: = Undefined
// CHECK: [[memberPresent]]([[memberObject]]):
// CHECK: [[memberValue]] = PropGet [[memberObject]] key="b"
// CHECK: [[memberTest]] = ToBoolean [[memberValue]]
// CHECK-NEXT: Branch [[memberTest]] ->
// CHECK-NOT: = Undefined
// CHECK-LABEL: function {{*}}name="negated"
// CHECK-NOT: = Undefined
// CHECK: [[negatedBase]] = TypeTest [[negatedA]] testedType=undefined|null @
// CHECK-NEXT: Branch [[negatedBase]] -> taken [[then]](), notTaken {{*}}(| 0)
// CHECK: [[then]]():
// CHECK-NEXT: = Integer integer=1 @
// CHECK-LABEL: function {{*}}name="value"
// CHECK-COUNT-1: = Undefined
// CHECK-NOT: = Undefined

// RUN(NEGATED): lower
// NEGATED-LABEL: function {{*}}name="negated"
// NEGATED-NOT: = Undefined
// NEGATED-NOT: LogicalNot
// NEGATED-LABEL: function {{*}}name="value"

export function call(a: any) {
  if (a?.b?.()) return 1;
  return 0;
}

export function member(a: any) {
  if (a?.b) return 1;
  return 0;
}

export function negated(a: any) {
  if (!a?.b) return 1;
  return 0;
}

export function value(a: any) {
  const v = a?.b;
  if (v) return 1;
  return 0;
}
