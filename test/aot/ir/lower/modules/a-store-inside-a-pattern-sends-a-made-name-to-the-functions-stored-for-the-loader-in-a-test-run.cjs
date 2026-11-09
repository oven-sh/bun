// `bun test --aot` builds with the same scan, and draws no TS100080: a store inside a pattern or at the head of a loop sends a name that is made
// as the tests run to what is stored, as in an executable: a-store-inside-a-pattern-sends-a-made-name-to-the-functions-stored-for-the-loader.cjs

// RUN: lower
// OPTIONS: runs-tests builtin-modules
// CHECK-LABEL: function {{*}}name="load"
// CHECK: = AreLoaderFunctionsStored
// CHECK: = RequireDynamic
// CHECK-LABEL: function {{*}}name="resolve"
// CHECK: = AreLoaderFunctionsStored

// FILE: main.cjs
const Module = require("node:module");
const original = Module._resolveFilename;
[Module._resolveFilename] = [
  function (request, ...rest) {
    return original.call(this, request, ...rest);
  },
];
const required = Module.prototype.require;
for (Module.prototype.require of [
  function (request) {
    return required.call(this, request);
  },
]);
function load(name) {
  return require("./" + name + ".js");
}
function resolve(name) {
  return require.resolve("./" + name + ".js");
}
console.log(load(process.argv[2]).value, resolve(process.argv[2]));

// FILE: subject.js
module.exports = { value: 41 };
