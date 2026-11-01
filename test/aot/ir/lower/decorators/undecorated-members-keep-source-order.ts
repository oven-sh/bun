// RUN: lower
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: = Call {{*}}calleeName="f"
// CHECK: PropDefine {{*}}key="a"
// CHECK: = Call {{*}}calleeName="g"
// CHECK: PropDefine {{*}}key="b"
// CHECK: = Call {{*}}calleeName="h"
// CHECK: PropDefine {{*}}key="c"

declare const d: any;
declare function f(): unknown;
declare function g(): unknown;
declare function h(): unknown;

export class C {
  a = f();
  @d b = g();
  c = h();
}
