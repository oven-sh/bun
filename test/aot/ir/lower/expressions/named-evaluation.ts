// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK-LABEL: function {{*}}name="f"
// CHECK-LABEL: function {{*}}name="g"
// CHECK-LABEL: function {{*}}name="C"
// CHECK-LABEL: function {{*}}name="h"
// CHECK-LABEL: function {{*}}name="x"

// RUN(UNNAMED): lower
// UNNAMED-NOT: function {{*}}name="k"
// UNNAMED-NOT: function {{*}}name="p"

type Callback = () => void;

export function create(c: any, o: any) {
  const f = function () {};
  const g = () => {};
  const C = class {};
  const h = (function () {}) as Callback;
  let x;
  x = function () {};
  const k = c ? function () {} : null;
  o.p = function () {};
  return [f, g, C, h, x, k];
}
