// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|[[t]] site=w{{*}}}, {type=undefined|null|Array<undefined|null|[[t]]> site=w{{*}}}]
// CHECK-LABEL: function {{*}}name="g"
// CHECK: parameters=[{type=undefined|null|L{{*}} site=w{{*}}}]
// CHECK-NOT: : undefined|null|[[t]])

// A type parameter is a layout of its own, with or without a bound, and a position of that type is checked. The parameter of `g` has another layout than the one of `f`.
interface Node {
  kind: number;
}

export function f<T extends Node>(n: T, m: T[]) {}

export function g<T>(n: T) {}
