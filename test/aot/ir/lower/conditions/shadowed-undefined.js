// RUN: lower
// CHECK-LABEL: function {{*}}name="shadowed"
// CHECK-NEXT: ([[u]]: {{*}}, [[x]]:
// CHECK-NOT: TypeTest
// CHECK: = StrictEq [[x]], [[u]]
// CHECK-NOT: TypeTest
// CHECK-LABEL: function {{*}}name="unshadowed"
// CHECK-NOT: StrictEq
// CHECK: = TypeTest {{*}}testedType=undefined @
// CHECK-NOT: StrictEq

export function shadowed(undefined, x) {
  if (x === undefined) return 1;
  return 0;
}

export function unshadowed(x) {
  if (x === undefined) return 1;
  return 0;
}
