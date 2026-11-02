// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[namespace]] = FinishObject
// CHECK: PropSet [[namespace]], {{*}}key="f"
// CHECK: PropSet [[namespace]], {{*}}key="C"

// RUN(LOCAL): lower
// LOCAL-NOT: key="g"

export namespace N {
  export function f() {}
  export class C {}
  function g() {}
}
