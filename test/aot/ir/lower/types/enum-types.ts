// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|i32|absent site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|1|absent site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|"x" site=

// An enum with several numeric members takes every int32: `E.A | E.B` has the type `E` and is no member. One member alone is its value, and so is a string member. `undefined` is what a `let` without an initializer holds.
enum E {
  A = 1,
  B = 2,
}

enum S {
  X = "x",
}

export let a: E;
export let b: E.A;
export let c: S;
