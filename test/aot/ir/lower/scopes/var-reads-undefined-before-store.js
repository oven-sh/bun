// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[undefined]] = Undefined
// CHECK: = Call {{*}}, -, [[undefined]] calleeName="g"

// RUN(ZONE): lower
// ZONE-LABEL: function {{*}}name="f"
// ZONE-NOT: = Absent
// ZONE-NOT: CheckInitialized

export function f() {
  g(x);
  var x = 1;
}
