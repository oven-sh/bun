// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = PropGet {{*}}key="b"
// CHECK: = PropGet {{*}}key="c"

// RUN(UNUSED): lower
// UNUSED-NOT: = PropGet {{*}}key="a"

namespace N {
  export const a = 1;
  export const b = 2;
  export const c = 3;
}

import unused = N.a;

export import exported = N.b;

export namespace M {
  import inner = N.c;
  export const d = 4;
}
