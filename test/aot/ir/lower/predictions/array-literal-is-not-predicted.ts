// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[constant]] = Data data=
// CHECK-NEXT: Return [[constant]]
// CHECK-LABEL: function {{*}}name="g"
// CHECK: [[array]] = NewArray {{*}}contents=number
// CHECK-NEXT: Return [[array]]
// CHECK-LABEL: function {{*}}name="h"
// CHECK: [[strings]] = NewArray {{*}}contents=anything
// CHECK-NEXT: Return [[strings]]

// RUN(DATA): link
// DATA: function {{*}}name="f"
// DATA: = Data data=[[data]]
// DATA: data [[data]] root=Array{contents=number elements=

// A literal without a written type holds the numbers that the checker infers. It says nothing of other elements, and nothing converts them: the engine finds out what they are.

export function f() {
  return [1, 2];
}

export function h(s: string) {
  return [s, "t"];
}

export function g(n: number) {
  return [n, 2];
}
