// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|L{{*}} flags=[IsExpected]}] results=[{type=number site=[[result]]}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="x"
// CHECK-NEXT: [[returned]] = Convert [[read]] declared={type=number site=[[result]]} @
// CHECK-NEXT: Return [[returned]]

// Nobody compared a declaration file with the code it describes, so a type from one is only expected. The only conversion of what is read is the one to the result of `f`.
/// <reference path="../types/imports/shapes.d.ts" />

export function f(d: Declared) {
  return d.x;
}
