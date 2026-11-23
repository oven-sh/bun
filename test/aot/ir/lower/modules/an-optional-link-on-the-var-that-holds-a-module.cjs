// A `var` that holds what `require` answers is undefined until its statement has run. `values?.counter` asks what the `var` holds and leaves for undefined: nothing throws.
// A `const` holds the module wherever it can be read, so the link never leaves and the member stays the variable of the module.
// RUN: lower
// CHECK-LABEL: function {{*}}name="reads"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = TypeTest {{*}}testedType=undefined|null
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="counter"
// CHECK-LABEL: function {{*}}name="readsQuoted"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = TypeTest {{*}}testedType=undefined|null
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="counter"
// CHECK-LABEL: function {{*}}name="calls"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = TypeTest {{*}}testedType=undefined|null
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="bump"
// CHECK-LABEL: function {{*}}name="readsWithoutTheLink"
// CHECK: RequireObjectCoercible {{*}}name="counter"
// CHECK-LABEL: function {{*}}name="readsBehindConstant"
// CHECK-NOT: PropGet {{*}}key="counter"
// CHECK: Return

exports.reads = function reads() {
  return values?.counter;
};
exports.readsQuoted = function readsQuoted() {
  return values?.["counter"];
};
exports.calls = function calls() {
  return values?.bump();
};
exports.readsWithoutTheLink = function readsWithoutTheLink() {
  return values.counter;
};
exports.readsBehindConstant = function readsBehindConstant() {
  return constant?.counter;
};
if (exports.wanted) {
  var values = require("./imports/values");
}
const constant = require("./imports/values");
