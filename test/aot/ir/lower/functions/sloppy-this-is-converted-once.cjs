// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[IsSloppy, HasThis,
// CHECK: b0([[entry]]: anything):
// CHECK: = ToThis [[entry]]
// CHECK-NOT: ToThis
// CHECK: = NewArray [[this]], [[this]] contents=

function f() {
  return [this, this];
}

module.exports = f;
