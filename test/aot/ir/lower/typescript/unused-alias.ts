// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = PropGet {{*}}key="b"
// CHECK: = PropGet {{*}}key="d"

// RUN(UNUSED): lower
// UNUSED-NOT: = PropGet {{*}}key="a"
// UNUSED-NOT: = PropGet {{*}}key="c"

namespace N {
  export const a = 1;
  export const b = 2;
  export const c = 3;
  export const d = 4;
}

import unused = N.a;

export import exported = N.b;

export namespace M {
  import inner = N.c;
  import read = N.d;
  export const e = read;
}
