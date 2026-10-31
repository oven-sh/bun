// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[a]] = Call {{*}}calleeName="g"
// CHECK: = NewClosure [[a]] function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=anything}] thisType
// CHECK: b0([[outerCopy]]: anything):
// CHECK: = NewClosure [[outerCopy]] function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=anything}] thisType
// CHECK: b0([[innerCopy]]: anything):
// CHECK: Return [[innerCopy]]

declare function g(): unknown;

export function f() {
  const a = g();
  return () => () => a;
}
