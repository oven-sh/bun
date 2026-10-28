// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[a]]: undefined|number):
// CHECK-NOT: = Call
// CHECK: [[isMissing]] = TypeTest [[a]] testedType=undefined @
// CHECK-NEXT: Branch [[isMissing]] -> taken [[missing]](| 0), notTaken [[present]](| 0)
// CHECK: [[missing]]([[proof]]):
// CHECK-NEXT: Jump -> next [[default]]()
// CHECK: [[default]]():
// CHECK: = Call
// CHECK: [[present]]([[value]]):
// CHECK-NEXT: Jump -> next [[join]]([[value]])

declare function g(): number;

export function f(a = g()) {}
