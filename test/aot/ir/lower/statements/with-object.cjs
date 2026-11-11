// RUN: lower
// CHECK-LABEL: function {{*}}name="dynamic"
// CHECK: [[object]] = ToObject
// CHECK: ScopeHasBinding [[object]] key="x"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NOT: ToObject
// CHECK-NOT: ScopeHasBinding
// CHECK: key="x" [isFreeName]

function dynamic(o) {
  with (o) {
    x;
  }
}

function plain() {
  x;
}

module.exports = { dynamic, plain };
