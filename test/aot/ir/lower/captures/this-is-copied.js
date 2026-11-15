// A file without types: the entry tests the receiver of a method as it does in a file with them, and a closure's copy of it goes by the same site.
// RUN: link
// CHECK: layout [[instance]] kind=Instance name="C"
// CHECK-LABEL: function {{*}}name="m"
// CHECK: thisType={type=[[instance]]}
// CHECK: b0([[this]]: [[instance]]):
// CHECK: = NewClosure [[this]] function=
// CHECK-LABEL: function {{*}}name="g"
// CHECK: thisType={type=[[instance]]}
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=[[instance]] variableName="this"}] thisType
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=[[instance]] variableName="this"}] thisType

export class C {
  x = 1;
  m() {
    return () => this.x;
  }
  get g() {
    return (() => this.x)();
  }
}

// A method has its body once reached code reads its name.
export function readsTheNames(o) { return [o.m]; }
