// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[a]] = PropGet {{*}}key="a"
// CHECK: = PropGet [[a]] key="b"
// CHECK-COUNT-2: = Call {{*}}calleeName="use"

// RUN(OUTER): lower
// OUTER-COUNT-1: = PropGet {{*}}key="a"
// OUTER-NOT: = PropGet {{*}}key="a"

// RUN(INNER): lower
// INNER-COUNT-1: = PropGet {{*}}key="b"
// INNER-NOT: = PropGet {{*}}key="b"

declare function use(value: unknown): void;

namespace N {
  export namespace a {
    export const b = 1;
  }
}

import x = N.a.b;

use(x);
use(x);
