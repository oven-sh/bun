// RUN: lower
// CHECK-LABEL: function {{*}}name="isObject"
// CHECK: [[callable]] = TypeTest [[x]] testedType=function @
// CHECK-NEXT: Branch [[callable]] -> taken {{*}}(| 0), notTaken [[rest]](| 0)
// CHECK: [[rest]]([[remaining]]):
// CHECK-NEXT: [[object]] = TypeTest [[remaining]] testedType=null|object @
// CHECK-NEXT: Branch [[object]] -> taken [[passed]](| 0), notTaken {{*}}(| 0)
// CHECK: [[passed]]({{*}}):
// CHECK-NEXT: Jump -> next [[then]]()
// CHECK: [[then]]():
// CHECK: = Call {{*}}calleeName="hit"
// CHECK-LABEL: function {{*}}name="notObject"
// CHECK: [[notCallable]] = TypeTest [[y]] testedType=function @
// CHECK-NEXT: Branch [[notCallable]] -> taken {{*}}(| 0), notTaken [[notRest]](| 0)
// CHECK: [[notRest]]([[notRemaining]]):
// CHECK-NEXT: [[notObject]] = TypeTest [[notRemaining]] testedType=null|object @
// CHECK-NEXT: Branch [[notObject]] -> taken {{*}}(| 0), notTaken [[failed]](| 0)
// CHECK: [[failed]]({{*}}):
// CHECK-NEXT: Jump -> next [[notThen]](
// CHECK: [[notThen]](
// CHECK: = Call {{*}}calleeName="hit"

// RUN(FUNCTIONS): lower
// FUNCTIONS-LABEL: function {{*}}name="notObject"
// FUNCTIONS: Branch {{*}} -> taken [[function]](| 0),
// FUNCTIONS: [[function]]({{*}}):
// FUNCTIONS-NEXT: Jump -> next [[then]](
// FUNCTIONS: [[then]](
// FUNCTIONS: = Call {{*}}calleeName="hit"

// RUN(TESTS): lower
// TESTS-COUNT-4: = TypeTest
// TESTS-NOT: = TypeTest

// RUN(NOWHERE): lower
// NOWHERE-NOT: = TypeOf
// NOWHERE-NOT: StrictEq
// NOWHERE-NOT: = String

export function isObject(x: any, hit: any): any {
  if (typeof x === "object") return hit(x);
  return x;
}

export function notObject(x: any, hit: any): any {
  if (typeof x !== "object") return hit(x);
  return x;
}
