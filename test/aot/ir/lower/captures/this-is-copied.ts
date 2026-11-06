// RUN: link
// CHECK: layout [[instance]] kind=Instance name="C"
// CHECK-LABEL: function {{*}}name="m"
// CHECK: thisType={type=[[instance]] site=[[site]]}
// CHECK: b0([[this]]: [[instance]]):
// CHECK-NOT: = NewObject
// CHECK: = NewClosure [[this]] function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=[[instance]] site=[[site]]}] thisType
// CHECK-NOT: GetEnvironmentField
// CHECK: Return

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: env L

export class C {
  x = 1;
  m() {
    return () => this.x;
  }
}
