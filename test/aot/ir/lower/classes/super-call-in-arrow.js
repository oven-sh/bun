// RUN: lower
// CHECK-LABEL: function {{*}}name="construct" {{*}}kind=Arrow
// CHECK: [[parent]] = GetSuperBase [[callee]] @
// CHECK: [[this]] = SuperConstruct [[parent]],
// CHECK: = CallDirect {{*}}function=[[initializer]]
// CHECK: function [[initializer]] {{*}}kind=Initializer

// RUN(CONSTRUCTOR): lower
// CONSTRUCTOR-LABEL: function {{*}}name="Deferred" {{*}}kind=DerivedConstructor
// CONSTRUCTOR-NOT: SuperConstruct
// CONSTRUCTOR-NOT: CallDirect
// CONSTRUCTOR-LABEL: function {{*}}name="construct"

class Base {}

export class Deferred extends Base {
  x = 1;
  constructor() {
    const construct = () => super();
    construct();
  }
}
