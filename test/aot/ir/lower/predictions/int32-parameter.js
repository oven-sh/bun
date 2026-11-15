// RUN: lower
// CHECK-LABEL: function {{*}}name="key"
// CHECK: parameters=[{type=i32 flags=[IsExpected]}]
// CHECK-LABEL: function {{*}}name="keyOfAnything"
// CHECK-NOT: i32
// CHECK-LABEL: function {{*}}name="mask"
// CHECK: parameters=[{type=i32 flags=[IsExpected]}]
// CHECK-LABEL: function {{*}}name="scaled"
// CHECK-NOT: i32

// A key of a list and an operand of a bit operator are expected to be int32s. A key of anything may be a name, and a factor may be a fraction.

export function key(at) {
  return ["ada", , "grace"][at].length;
}

export function keyOfAnything(record, at) {
  return record[at];
}

export function mask(flags) {
  return flags & 7;
}

export function scaled(n) {
  return n * 0.5;
}
