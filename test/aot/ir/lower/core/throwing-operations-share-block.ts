// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: handler=
// CHECK: = Call {{*}}calleeName="g"
// CHECK-NEXT: = Call {{*}}calleeName="h"
// CHECK-NEXT: = Call {{*}}calleeName="i"

export function f(g: () => void, h: () => void, i: () => void, k: (error: unknown) => void) {
  try {
    g();
    h();
    i();
  } catch (e) {
    k(e);
  }
}
