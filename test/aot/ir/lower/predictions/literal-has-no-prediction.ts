// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="x"
// CHECK-NOT: Convert
// CHECK: [[array]] = NewArray {{*}}[[read]],
// CHECK-NEXT: [[returned]] = Convert [[array]] declared={type=undefined|null|Array<undefined|null|boolean|number|string> site=w{{*}}} @
// CHECK-NEXT: Return [[returned]]

export function f() {
  return [1 + 2, "a", { x: 1 }.x, -1, !0];
}
