// RUN: lower
// CHECK-LABEL: function {{*}}name="atConstant"
// CHECK-NOT: Convert
// CHECK: [[first]] = ElemGet [[array]],
// CHECK-NEXT: Return [[first]]
// CHECK-LABEL: function {{*}}name="atVariable"
// CHECK-NOT: Convert
// CHECK: [[element]] = ElemGet [[elements]],
// CHECK-NEXT: Return [[element]]

// A read of an element is converted to nothing: the engine follows what is stored.
export function atConstant(a: number[]) {
  return a[0];
}

export function atVariable(a: number[], i: number) {
  return a[i];
}
