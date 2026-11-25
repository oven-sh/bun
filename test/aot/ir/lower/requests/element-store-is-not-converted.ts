// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: ([[array]]: {{*}}, [[stored]]: anything):
// CHECK-NOT: Convert
// CHECK: ElemSet [[array]], {{*}}, [[stored]] @

// RUN(LINKED): link
// LINKED: function {{*}}name="f"
// LINKED-NOT: Convert
// LINKED: ElemSet

// An element is no annotated position: what is stored into one is converted to nothing.
export function f(a: number[], v: any) {
  a[0] = v;
}
