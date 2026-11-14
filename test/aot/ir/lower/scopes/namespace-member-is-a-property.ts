// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: PropSet {{*}}key="v"
// CHECK-LABEL: function {{*}}name="r"
// CHECK: [[container]] = GetModuleVariable variable=
// CHECK: = PropGet [[container]] key="v"

// RUN(VARIABLES): link
// VARIABLES-NOT: variable {{*}}name="v"

namespace N {
  export let v = 1;
  export function r() {
    return v;
  }
}

export const read = N.r;
