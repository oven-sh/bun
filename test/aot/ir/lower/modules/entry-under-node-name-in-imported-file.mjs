// `bun run` reads require("fs") as require("node:fs") in a CommonJS file that an import has loaded, and as it is written in one that require() has loaded. The first load of the file counts.
// The program spells the key "fs" in require.cache, so the two differ: each CommonJS file asks at its head how it is loaded, and each require("fs") goes by the answer.
// A file that was loaded by require() asks the host, which looks in the table. Any other gets the module. An ES module reads the name as it is written.
// RUN: link
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: = WasLoadedSynchronously module=[[file]]
// CHECK-LABEL: function {{*}}name="imported"
// CHECK: [[name]] = String string="fs"
// CHECK: [[answer]] = WasLoadedSynchronously module=[[file]]
// CHECK: Branch [[answer]]
// CHECK: = RequireDynamic [[name]]
// CHECK: = RequireModule {{*}}specifier="fs"
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: = WasLoadedSynchronously
// CHECK-LABEL: function {{*}}name="required"
// CHECK: [[other]] = String string="fs"
// CHECK: [[second]] = WasLoadedSynchronously
// CHECK: Branch [[second]]
// CHECK: = RequireDynamic [[other]]
// CHECK: = RequireModule {{*}}specifier="fs"
// CHECK-LABEL: function {{*}}kind=Module flags=[IsAsync]
// CHECK-NOT: WasLoadedSynchronously
// CHECK-LABEL: function {{*}}role=Signature

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
