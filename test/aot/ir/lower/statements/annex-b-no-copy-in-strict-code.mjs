// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK: = NewClosure
// CHECK: [[read]] = PropGet {{*}}key="inner" [isFreeName]
// CHECK: Return [[read]]

export function outer() {
  {
    function inner() {}
  }
  return inner;
}
