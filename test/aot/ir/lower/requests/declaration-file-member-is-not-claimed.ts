// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|L{{*}} flags=[IsExpected]}] results=[{type=anything}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="x"
// CHECK-NEXT: Return [[read]]

// Nobody compared a declaration file with the code it describes, so a type from one is only expected. What is read is converted to nothing.
/// <reference path="../types/imports/shapes.d.ts" />

export function f(d: Declared) {
  return d.x;
}
