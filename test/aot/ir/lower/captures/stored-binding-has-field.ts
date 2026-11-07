// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: PutEnvironmentField [[environment]], {{*}}layout=[[layout]]
// CHECK: = NewClosure [[environment]] function=
// CHECK: PutEnvironmentField [[environment]], {{*}}layout=[[layout]]
// CHECK-LABEL: function {{*}}name="r"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK: = GetEnvironmentField {{*}}layout=[[layout]]

export function f() {
  let a = 1;
  const r = () => a;
  a = 2;
  return r;
}
