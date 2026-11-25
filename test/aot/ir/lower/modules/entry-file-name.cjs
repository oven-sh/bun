// An executable holds a further entry point as a file that ends in `.js`, whatever its source ends in. The run time finds it by that name from the folder of the file that asks, so a name that the build knows leads there too.
// RUN: lower
// ENTRY: main.cjs plugins/a.cjs
// DIAGNOSTIC: TS100150 main.cjs:18
// CHECK-LABEL: function {{*}}name="joined"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK: Return
// CHECK-LABEL: function {{*}}name="written"
// CHECK: EvaluateModule module=m
// CHECK: Return
// CHECK-LABEL: function {{*}}name="endsOtherwise"
// CHECK: EvaluateModule module=m
// CHECK: Return
// CHECK-LABEL: function {{*}}name="resolved"
// CHECK-NOT: ResolveDynamic
// CHECK: = String string="{{*}}plugins/a.cjs"
// CHECK: Return
// CHECK-LABEL: function {{*}}name="absent"
// CHECK-NOT: EvaluateModule

// FILE: main.cjs
function joined() {
  return require(["./plugins/a", ".js"].join(""));
}

function written() {
  return require("./plugins/a.js");
}

function endsOtherwise() {
  return require("./plugins/a.mjs");
}

function resolved() {
  return require.resolve("./plugins/a.js");
}

function absent() {
  return require("./plugins/b.js");
}

module.exports = { joined, written, endsOtherwise, resolved, absent, below: require("./lib/loader.cjs") };

// FILE: lib/loader.cjs
module.exports = require("../plugins/a.js");

// FILE: plugins/a.cjs
exports.name = "a";
