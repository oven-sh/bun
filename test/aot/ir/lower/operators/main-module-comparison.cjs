// RUN: lower
// CHECK-LABEL: function {{*}}name="equal"
// CHECK-NOT: StrictEq
// CHECK: = Boolean boolean=true
// CHECK-NOT: StrictEq
// CHECK-LABEL: function {{*}}name="notEqual"
// CHECK-NOT: StrictEq
// CHECK: = Boolean
// CHECK-NOT: boolean=true
// CHECK-NOT: StrictEq
// CHECK-LABEL: function {{*}}name="swapped"
// CHECK-NOT: StrictEq
// CHECK: = Boolean boolean=true
// CHECK-NOT: StrictEq
// CHECK-LABEL: function {{*}}name="condition"
// CHECK-NOT: StrictEq
// CHECK: = Call {{*}}calleeName="f"
// CHECK-NOT: StrictEq
// CHECK-LABEL: function {{*}}name="other"
// CHECK: = PropGet {{*}}key="main"
// CHECK: = StrictEq

function equal() {
  return require.main === module;
}

function notEqual() {
  return require.main !== module;
}

function swapped() {
  return module === require.main;
}

function condition(f) {
  if (require.main === module) f();
}

function other() {
  return require.main === exports;
}

module.exports = { equal, notEqual, swapped, condition, other };
