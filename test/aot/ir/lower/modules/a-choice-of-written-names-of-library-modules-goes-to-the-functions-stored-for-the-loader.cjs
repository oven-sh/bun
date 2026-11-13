// `require(flag ? "bun:os" : "node:url")`: the transpiler reads each name as it reads a single literal, and a library module's stays a call of require(): where the program has stored a function
// for the loader, the call goes to it under the name that the transpiler reads: `bun:os` is `os` to it.
// A choice of files asks nobody: a-choice-of-written-names-asks-no-function-stored-for-the-loader.cjs

// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100080 1
// CHECK-LABEL: function {{*}}name="choose"
// CHECK: = AreLoaderFunctionsStored
// CHECK: SwitchString
// CHECK: [[first]] = String string="os"
// CHECK: = RequireDynamic [[first]]
// CHECK: [[second]] = String string="node:url"
// CHECK: = RequireDynamic [[second]]
// CHECK: = RequireModule

// FILE: main.cjs
const Module = require("node:module");
const original = Module.prototype.require;
Module.prototype.require = function (name) {
  return original.call(this, name);
};
function choose(flag) {
  return require(flag ? "bun:os" : "node:url");
}
console.log(typeof choose(process.argv.length > 99).parse);
