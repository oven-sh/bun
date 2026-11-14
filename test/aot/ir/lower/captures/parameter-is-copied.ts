// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=number}]
// CHECK: b0([[p]]: number):
// CHECK: = NewClosure [[p]] function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=number variableName="p"}] thisType

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: = NewObject
// ENVIRONMENTS-NOT: env L

export function f(p: number) {
  return () => p;
}
