// A file without types: the entry tests the receiver of a method as it does in a file with them, and a closure's copy of it goes by the same site.
// RUN: link
// CHECK: layout [[instance]] kind=Instance name="C"
// CHECK-LABEL: function {{*}}name="m"
// CHECK: thisType={type=[[instance]] site=[[site]]}
// CHECK: b0([[this]]: [[instance]]):
// CHECK: = NewClosure [[this]] function=
// CHECK-LABEL: function {{*}}name="g"
// CHECK: thisType={type=[[instance]] site=[[siteOfGetter]]}
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=[[instance]] site=[[site]] variableName="this"}] thisType
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=[[instance]] site=[[siteOfGetter]] variableName="this"}] thisType

export class C {
  x = 1;
  m() {
    return () => this.x;
  }
  get g() {
    return (() => this.x)();
  }
}
