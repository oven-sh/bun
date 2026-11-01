// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[undefined]] = Undefined
// CHECK: [[convertedUndefined]] = Convert [[undefined]] declared={type=number flags=[IsExpected]}
// CHECK: = Call {{*}}, -, [[convertedUndefined]] calleeName="g"

// RUN(ZONE): lower
// ZONE-LABEL: function {{*}}name="f"
// ZONE-NOT: = Absent
// ZONE-NOT: CheckInitialized

export function f() {
  g(x);
  var x = 1;
}
