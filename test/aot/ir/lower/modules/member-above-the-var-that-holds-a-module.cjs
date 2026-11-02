// A `var` that holds what `require` answers is undefined above its statement. The test that throws there names the member that is asked for.
// RUN: lower
// CHECK-LABEL: function {{*}}name="reads"
// CHECK: RequireObjectCoercible {{*}}name="counter"
// CHECK-LABEL: function {{*}}name="readsDeep"
// CHECK: RequireObjectCoercible {{*}}name="one"
// CHECK-LABEL: function {{*}}name="calls"
// CHECK: RequireObjectCoercible {{*}}name="bump"
// CHECK-LABEL: function {{*}}name="stores"
// CHECK: RequireObjectCoercible {{*}}nullishAccess=Write name="named"

exports.reads = function reads() {
  return values.counter;
};
exports.readsDeep = function readsDeep() {
  return values.one.length;
};
exports.calls = function calls() {
  return values.bump();
};
exports.stores = function stores() {
  common.named = 2;
};
var values = require("./imports/values");
var common = require("./imports/common.cjs");
