// The build has followed the name to a file. `bun run` and an executable of `bun build --compile` still hand a name that is made as the program runs to the functions
// that the program has stored for the loader. So where reached code stores one, the cases of the switch stand behind a test of whether one is stored.
// A file that stores none pays nothing: a-name-out-of-a-set-is-a-case-of-the-switch.mjs

// RUN: lower
// CHECK-LABEL: function {{*}}name="load"
// CHECK: = AreLoaderFunctionsStored
// CHECK: = RequireDynamic
// CHECK: SwitchString {{*}}strings=["./subject.js"]
// CHECK: = RequireDynamic

// FILE: main.cjs
const original = require.extensions[".js"];
require.extensions[".js"] = function (module, filename) {
  return original(module, filename);
};
function load(name) {
  return require("./" + name + ".js");
}
console.log(load(process.argv[2]).value);

// FILE: subject.js
module.exports = { value: 41 };
