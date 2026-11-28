// The program spells the key "fs" in require.cache, so each require("fs") asks the host, which looks in the table. How the file was loaded does not count.
// RUN: link
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="imported"
// CHECK-NOT: Branch
// CHECK: [[name]] = String string="fs"
// CHECK-NOT: Branch
// CHECK: = RequireDynamic [[name]]
// CHECK-NOT: RequireModule
// CHECK-LABEL: function {{*}}name="required"
// CHECK-NOT: Branch
// CHECK: [[other]] = String string="fs"
// CHECK-NOT: Branch
// CHECK: = RequireDynamic [[other]]
// CHECK-NOT: RequireModule
// CHECK-LABEL: function {{*}}kind=Module flags=[IsAsync]

// FILE: main.mjs
import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
load.cache["fs"] = { exports: { readFileSync: 1 } };
console.log((await import("./imported.cjs")).default.imported(), load("./required.cjs").required());

// FILE: imported.cjs
exports.imported = function imported() {
  return require("fs");
};

// FILE: required.cjs
exports.required = function required() {
  return require("fs");
};
