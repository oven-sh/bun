// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[a]]: anything, [[b]]: anything):
// CHECK: [[missing]] = TypeTest [[b]] testedType=undefined @
// CHECK-NEXT: Branch [[missing]] -> taken [[join]]([[a]]), notTaken

// RUN(ZONE): lower
// ZONE-NOT: CheckInitialized
// ZONE-NOT: = Absent

export function f(a, b = a) {}
