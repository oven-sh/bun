// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[p]]:
// CHECK: = NewObject -, [[p]] layout=[[layout]] fields=[0]
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: = GetEnvironmentField {{*}}layout=[[layout]]

// RUN(ZONE): lower
// ZONE-NOT: = Absent
// ZONE-NOT: CheckInitialized

export function f(p: number) {
  const read = () => p;
  p++;
  return read;
}
