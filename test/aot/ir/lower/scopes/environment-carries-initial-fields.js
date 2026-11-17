// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[p]]:
// CHECK: [[undefined]] = Undefined
// CHECK: = NewObject -, [[p]], [[undefined]] layout={{*}}fields=[0, 1]
// CHECK-NOT: = NewObject

// RUN(ZONE): lower
// ZONE-NOT: = Absent

export function f(p) {
  var v;
  let l;
  const read = () => [p, v, l];
  p = 1;
  v = 2;
  l = 3;
  return read;
}
