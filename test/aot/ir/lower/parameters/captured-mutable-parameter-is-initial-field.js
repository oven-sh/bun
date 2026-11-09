// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[p]]: anything):
// CHECK-NOT: PutEnvironmentField
// CHECK: [[environment]] = NewObject -, [[p]] layout=[[layout]] fields=[0]
// CHECK: = NewClosure [[environment]] function=

export function f(p) {
  const read = () => p;
  p++;
  return read;
}
