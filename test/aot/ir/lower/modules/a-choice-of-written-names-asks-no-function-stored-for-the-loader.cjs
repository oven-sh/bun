// `require(flag ? "./first.js" : "./second.js")`: the transpiler reads both names, as it reads a single literal: written names, which ask none of the functions that a program stores for the loader.
// A name that is made as the program runs does: a-name-made-as-the-program-runs-goes-to-the-functions-stored-for-the-loader.cjs

// RUN: lower
// CHECK-LABEL: function {{*}}name="choose"
// CHECK-NOT: AreLoaderFunctionsStored
// CHECK-NOT: RequireDynamic
// CHECK: Return

// FILE: main.cjs
const original = require.extensions[".js"];
require.extensions[".js"] = function (module, filename) {
  return original(module, filename);
};
function choose(flag) {
  return require(flag ? "./first.js" : "./second.js");
}
console.log(choose(process.argv.length > 99).value);

// FILE: first.js
module.exports = { value: 1 };

// FILE: second.js
module.exports = { value: 2 };
