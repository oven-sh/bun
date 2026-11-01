// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: ([[v]]: anything):
// CHECK: [[stored]] = Convert [[v]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet {{*}}, [[stored]] key="count"
// CHECK: [[read]] = PropGet {{*}}key="count"
// CHECK-NEXT: = Convert [[read]] declared={type=number flags=[IsExpected]}

// RUN(REQUESTS): lower
// REQUESTS-NOT: IsChecked
// REQUESTS-NOT: site=
// REQUESTS-NOT: illTypedCause=

import { state } from "./imports/state";

export function f(v) {
  state.count = v;
  return state.count;
}
