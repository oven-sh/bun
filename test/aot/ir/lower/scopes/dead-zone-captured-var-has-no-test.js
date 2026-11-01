// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[undefined]] = Undefined
// CHECK: = NewObject -, [[undefined]] layout=[[layout]] fields=[0]
// CHECK-LABEL: function {{*}}name="g"
// CHECK: = GetEnvironmentField {{*}}layout=[[layout]]

// RUN(ZONE): lower
// ZONE-NOT: = Absent
// ZONE-NOT: CheckInitialized

export function f() {
  const g = () => x;
  var x = 1;
  x = 2;
  return g;
}
