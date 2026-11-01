// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: handler=
// CHECK: = Call {{*}}calleeName="g"
// CHECK: role=CatchHandler
// CHECK-NOT: handler=
// CHECK: = Call {{*}}calleeName="h"

export function f(g: () => void, h: () => void) {
  try {
    g();
  } catch {}
  h();
}
