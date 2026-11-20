// RUN: lower
// CHECK-LABEL: function {{*}}name="C" {{*}}kind=BaseConstructor
// CHECK: = NewObject
// CHECK-NOT: = Call
// CHECK: = CallDirect {{*}}function=[[initializer]]
// CHECK: = Call {{*}}calleeName="g"
// CHECK: = Call {{*}}calleeName="h"
// CHECK: function [[initializer]] {{*}}kind=Initializer
// CHECK: = Call {{*}}calleeName="f"

declare function f(): number;
declare function g(): number;
declare function h(): void;

export class C {
  x = f();
  constructor(a = g()) {
    h();
  }
}
