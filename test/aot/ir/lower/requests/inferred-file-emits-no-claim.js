// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: ([[v]]: anything):
// CHECK-NOT: Convert
// CHECK: PropSet {{*}}, [[v]] key="count"
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="count"
// CHECK-NEXT: Return [[read]]

// RUN(REQUESTS): lower
// REQUESTS-NOT: IsChecked
// REQUESTS-NOT: site=
// REQUESTS-NOT: illTypedCause=

import { state } from "./imports/state";

export function f(v) {
  state.count = v;
  return state.count;
}
