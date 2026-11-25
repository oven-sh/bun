// RUN: lower
// CHECK-LABEL: function {{*}}name="alias"
// CHECK: EvaluateModule {{*}}[isCallOfRequire]
// CHECK-LABEL: function {{*}}name="stored"
// CHECK-NOT: EvaluateModule
// CHECK: = Call {{*}}calleeName="aliased"

// FILE: main.cjs
// `aliased = require; aliased(name)`: every store to the name is the file's own require. The file is brought, and the call stays a call. An alias in a plain const is a load, as it was.
let aliased;
const settled = require;
exports.alias = function alias() {
  return settled("./part.cjs");
};
exports.stored = function stored() {
  aliased = require;
  return aliased("./part.cjs");
};

// FILE: part.cjs
module.exports = 1;
