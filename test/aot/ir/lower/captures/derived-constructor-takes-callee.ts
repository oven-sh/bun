// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[constructor]] = NewClosure function=
// CHECK: = NewClass [[constructor]],
// CHECK-LABEL: function {{*}}kind=DerivedConstructor
// CHECK: TakesCallee
// CHECK-NOT: captures=
// CHECK: b0([[callee]]: function,
// CHECK: = GetSuperBase [[callee]]

class B {}

export function f() {
  return class extends B {
    constructor() {
      super();
    }
  };
}
