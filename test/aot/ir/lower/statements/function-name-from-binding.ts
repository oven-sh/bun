// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-LABEL: function {{*}}name="g"
// CHECK-LABEL: function {{*}}name="h"
// CHECK: function [[unnamed]] module=

// RUN(PATTERN): lower
// PATTERN-NOT: function {{*}}name="k"

export const f = function () {};
export const g = () => {};
export const h = (function () {});
export const [k] = [function () {}];
