// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[namespace]] = FinishObject
// CHECK: PutModuleVariable
// CHECK: [[name]] = Convert [[namespace]]
// CHECK: PropSet [[name]], {{*}}key="f"
// CHECK: PropSet [[name]], {{*}}key="C"

// RUN(LOCAL): lower
// LOCAL-NOT: key="g"

export namespace N {
  export function f() {}
  export class C {}
  function g() {}
}
