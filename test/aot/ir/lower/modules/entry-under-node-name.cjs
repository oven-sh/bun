// require() looks in require.cache for a Node.js module that is named without `node:`. The file spells the key "fs", so the host answers require("fs").
// require("node:fs") is bound to the module, and so is require("path"): the run time refuses an entry under a key that no file spells.
// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="bound"
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="asks"
// CHECK: [[name]] = String string="fs"
// CHECK: = RequireDynamic [[name]]
// RUN(HELD): link
// HELD: module {{*}}path="node:path" {{*}}RejectsRequireCacheOverride
// RUN(OPEN): link
// OPEN-NOT: module {{*}}path="node:fs" {{*}}RejectsRequireCacheOverride

exports.bound = function bound() {
  return [require("node:fs"), require("path")];
};
exports.asks = function asks() {
  return require("fs");
};
require.cache["fs"] = { exports: { readFileSync: 1 } };
