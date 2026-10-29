// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: NewObject
// CHECK: LoopHint
// CHECK-NOT: NewObject
// CHECK: = NewClosure [[x]] function=
// CHECK-NOT: NewObject
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=anything}] thisType
// CHECK-NOT: GetEnvironmentField

export function f(xs: unknown[], cb: (read: () => unknown) => void) {
  for (const x of xs) cb(() => x);
}
