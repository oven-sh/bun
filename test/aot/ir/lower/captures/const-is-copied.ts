// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[a]] = Call {{*}}calleeName="g"
// CHECK: = NewClosure [[a]] function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=anything}] thisType
// CHECK: b0([[copy]]: anything):
// CHECK-NOT: GetEnvironmentField
// CHECK: Return [[copy]]

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: = NewObject
// ENVIRONMENTS-NOT: env L

declare function g(): unknown;

export function f() {
  const a = g();
  return () => a;
}
