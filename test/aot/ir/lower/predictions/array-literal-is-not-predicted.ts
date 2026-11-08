// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[constant]] = Data data=
// CHECK-NEXT: Return [[constant]]
// CHECK-LABEL: function {{*}}name="g"
// CHECK: [[array]] = NewArray {{*}}contents=anything
// CHECK-NEXT: Return [[array]]

// RUN(DATA): link
// DATA: function {{*}}name="f"
// DATA: = Data data=[[data]]
// DATA: data [[data]] root=Array{contents=anything elements=

// A literal that is written under no type says nothing of its elements, and nothing converts it: the engine finds out what they are.

export function f() {
  return [1, 2];
}

export function g(n: number) {
  return [n, 2];
}
