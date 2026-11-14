// process.getBuiltinModule() asks none of the functions that a program stores for the loader, also where the name is one of two and the file stores such a function.
// require() of the same choice does: a-name-made-as-the-program-runs-goes-to-the-functions-stored-for-the-loader.cjs

// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100080 1
// CHECK-LABEL: function {{*}}name="choose"
// CHECK-NOT: AreLoaderFunctionsStored
// CHECK-NOT: RequireDynamic
// CHECK: Return

// FILE: main.cjs
const Module = require("node:module");
const original = Module.prototype.require;
Module.prototype.require = function (request) {
  return original.call(this, request);
};
function choose(flag) {
  return process.getBuiltinModule(flag ? "node:path" : "node:os");
}
console.log(typeof choose(process.argv.length > 99).EOL);
