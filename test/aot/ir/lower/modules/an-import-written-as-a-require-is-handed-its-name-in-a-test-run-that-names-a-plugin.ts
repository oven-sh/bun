// `import dep = require("./dep.cjs")` is a call of require(). In a test run that names Bun.plugin it is handed its name, as a call that is written out is, so that a plugin can answer for it.
// RUN: lower
// OPTIONS: runs-tests
// DIAGNOSTIC: TS100079 1
// CHECK: RequireDynamic
// CHECK-NOT: RequireModule

// FILE: main.ts
import dep = require("./dep.cjs");
Bun.plugin({ name: "swap", setup() {} });
console.log(dep);

// FILE: dep.cjs
module.exports = 1;
