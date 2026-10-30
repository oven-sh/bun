// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: = NewClosure [[environment]] function=
// CHECK: [[a]] = Call {{*}}calleeName="g"
// CHECK: PutEnvironmentField [[environment]], [[a]] layout=[[layout]]
// CHECK: = NewClosure [[a]] function=
// CHECK-LABEL: function {{*}}name="h"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=anything}] thisType

declare function g(): unknown;

export function f() {
  const a = g();
  return [h, () => a];

  function h() {
    return a;
  }
}
