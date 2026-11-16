// RUN: lower
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK: = Call {{*}}calleeName="g"
// CHECK-LABEL: function {{*}}name="logical"
// CHECK: = Boolean

// RUN(DEAD): lower
// DEAD-NOT: calleeName="f"
// DEAD-NOT: calleeName="h"
// DEAD-NOT: Branch

export function conditional(g: any, h: any) {
  return true ? g() : h();
}

export function logical(f: any) {
  return false && f();
}
