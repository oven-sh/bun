// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=number site=[[site]]}]
// CHECK: b0([[p]]: number):
// CHECK: = NewClosure [[p]] function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=number site=[[site]]}] thisType

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: = NewObject
// ENVIRONMENTS-NOT: env L

export function f(p: number) {
  return () => p;
}
