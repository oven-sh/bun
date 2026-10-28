// RUN: link
// CHECK: layout [[rest]] module=
// CHECK-NOT: fields=
// CHECK: layout
// CHECK: function {{*}}name="rests"
// CHECK: = NewObject layout=[[rest]] @
// CHECK: = NewObject layout=[[rest]] @

// RUN(INFERRED): link
// INFERRED: layout [[both]] module={{*}}fields=[{key="a" {{*}}{key="b"
// INFERRED: function {{*}}name="first"
// INFERRED: = NewObject {{*}}layout=[[both]] fields=[0, 1]
// INFERRED: function {{*}}name="second"
// INFERRED: = NewObject {{*}}layout=[[both]] fields=[1, 0]

// RUN(UNSORTED): link
// UNSORTED-NOT: layout {{*}}fields=[{key="b" {{*}}{key="a"

export function first(x, y) {
  return { a: x, b: y };
}

export function second(x, y) {
  return { b: x, a: y };
}

export function rests(x, y) {
  const { a, ...r1 } = x;
  const { b, ...r2 } = y;
  return [a, b, r1, r2];
}
