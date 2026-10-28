// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[a]]: anything, [[b]]: anything):
// CHECK: = TypeTest [[b]] testedType=undefined @
// CHECK: Jump -> next [[join]]([[a]])

// RUN(ZONE): lower
// ZONE-NOT: CheckInitialized
// ZONE-NOT: = Absent

export function f(a, b = a) {}
