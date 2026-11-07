// RUN: lower
// CHECK-LABEL: function {{*}}name="named"
// CHECK: = PropDelete {{*}}key="p"
// CHECK-NOT: mode=
// CHECK-LABEL: function {{*}}name="computedSuper"
// CHECK-NOT: PropDelete
// CHECK-NOT: ElemDelete
// CHECK: = Call {{*}}calleeName="f"
// CHECK-NEXT: [[computedError]] = NewRuntimeError runtimeError=DeleteSuperProperty
// CHECK-NEXT: Throw [[computedError]]
// CHECK-NOT: PropDelete
// CHECK-NOT: ElemDelete
// CHECK-LABEL: function {{*}}name="namedSuper"
// CHECK-NOT: PropDelete
// CHECK-NOT: ElemDelete
// CHECK: [[namedError]] = NewRuntimeError runtimeError=DeleteSuperProperty
// CHECK-NEXT: Throw [[namedError]]
// CHECK-NOT: PropDelete
// CHECK-NOT: ElemDelete

export function named(o) {
  return delete o.p;
}

class Base {}

export class Derived extends Base {
  computedSuper(f) {
    return delete super[f()];
  }

  namedSuper() {
    return delete super.p;
  }
}
