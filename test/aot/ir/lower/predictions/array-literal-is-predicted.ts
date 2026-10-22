// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[constant]] = Data data=
// CHECK-NEXT: [[returnedConstant]] = Convert [[constant]] declared={type=undefined|null|Array<number> site=w{{*}}} @
// CHECK-NEXT: Return [[returnedConstant]]
// CHECK-LABEL: function {{*}}name="g"
// CHECK: [[array]] = NewArray {{*}}contents=number
// CHECK-NEXT: [[returnedArray]] = Convert [[array]] declared={type=undefined|null|Array<number> site=w{{*}}} @
// CHECK-NEXT: Return [[returnedArray]]

// RUN(DATA): link
// DATA: function {{*}}name="f"
// DATA: = Data data=[[data]]
// DATA: data [[data]] root=Array{contents=number elements=

export function f() {
  return [1, 2];
}

export function g(n: number) {
  return [n, 2];
}
