// RUN: lower
// CHECK-LABEL: function {{*}}name="write"
// CHECK: = Call {{*}}calleeName="f"
// CHECK: = Call {{*}}calleeName="g"
// CHECK: PrivateSet
// CHECK-LABEL: function {{*}}name="test"
// CHECK: = Call {{*}}calleeName="h"
// CHECK: = PrivateHas

declare function f(): C;
declare function g(): number;
declare function h(): object;

export class C {
  #x = 1;
  static write() {
    f().#x = g();
  }
  static test() {
    return #x in h();
  }
}
