// RUN: lower
// CHECK-LABEL: function {{*}}name="render"
// CHECK-NOT: key="__proto__"
// CHECK: [[head]] = NewObject -, [[b]] layout={{*}}fields=[0]
// CHECK-NEXT: SetLiteralPrototype [[head]],
// CHECK-NEXT: = FinishObject [[head]]
// CHECK-NOT: key="__proto__"

export function render(p: object) {
  return <a __proto__={p} b={1} />;
}
