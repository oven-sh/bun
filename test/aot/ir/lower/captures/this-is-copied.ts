// RUN: link
// CHECK: layout [[instance]] kind=Instance name="C"
// CHECK-LABEL: function {{*}}name="m"
// CHECK: thisType={type=[[instance]]}
// CHECK: b0([[this]]: [[instance]]):
// CHECK-NOT: = NewObject
// CHECK: = NewClosure [[this]] function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=[[instance]] variableName="this"}] thisType
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

// A method has its body once reached code reads its name.
export function readsTheNames(o: any) { return [o.m]; }
