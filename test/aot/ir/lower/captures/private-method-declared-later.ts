// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[environment]] = NewObject layout=[[layout]]
// CHECK: = NewClosure [[environment]], [[token]] function=
// CHECK: [[method]] = NewClosure function=
// CHECK: PutEnvironmentField [[environment]], [[method]] layout=[[layout]]
// CHECK-LABEL: function {{*}}name="n"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}, {type=classtoken flags=[IsFromCompiler]}] thisType
// CHECK: [[closure]] = GetEnvironmentField {{*}}layout=[[layout]]
// CHECK-NOT: CheckInitialized
// CHECK: = Call [[closure]],

export function f() {
  return class {
    n() {
      return this.#m();
    }
    #m() {}
  };
}
