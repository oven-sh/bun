// RUN: lower
// CHECK-LABEL: function {{*}}name="render"
// CHECK: [[b]] = Boolean boolean=true
// CHECK: [[c]] = String string="x&y"
// CHECK: [[d]] = Integer integer=1
// CHECK: = NewObject -, [[b]], [[c]], [[d]] layout=

export function render() {
  return <a b c="x&amp;y" d={1} />;
}
