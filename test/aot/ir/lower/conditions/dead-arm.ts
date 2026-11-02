// RUN: lower
// CHECK-LABEL: function {{*}}name="and"
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK-NOT: calleeName="f"
// CHECK: = ToBoolean [[a]]
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="live"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="or"
// CHECK-NOT: calleeName="f"

export function and(f: any) {
  if (false && f()) return 1;
  return 0;
}

export function conditional(a: any, f: any) {
  if (true ? a : f()) return 1;
  return 0;
}

export function live(a: any, f: any) {
  if (a && f()) return 1;
  return 0;
}

export function or(f: any) {
  if (true || f()) return 1;
  return 0;
}
