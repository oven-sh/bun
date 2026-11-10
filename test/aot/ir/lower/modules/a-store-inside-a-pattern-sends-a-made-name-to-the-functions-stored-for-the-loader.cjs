// A store inside a pattern replaces Module._resolveFilename as an assignment does. The build points at the member, and a name that is made
// as the program runs goes to what is stored: a-name-made-as-the-program-runs-goes-to-the-functions-stored-for-the-loader.cjs

// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100080 main.cjs:3
// CHECK-LABEL: function {{*}}name="load"
// CHECK: = AreLoaderFunctionsStored
// CHECK: = RequireDynamic

// FILE: main.cjs
const Module = require("node:module");
const original = Module._resolveFilename;
[Module._resolveFilename] = [
  function (request, ...rest) {
    return original.call(this, request, ...rest);
  },
];
function load(name) {
  return require("./" + name + ".js");
}
console.log(load(process.argv[2]).value);

// FILE: subject.js
module.exports = { value: 41 };
