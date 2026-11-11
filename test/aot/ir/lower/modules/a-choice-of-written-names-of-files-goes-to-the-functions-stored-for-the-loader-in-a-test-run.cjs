// `require(flag ? "./first.js" : "./second.js")`: the transpiler reads each name as it reads a single literal. In a test run a written name of a file goes to the functions that the program has
// stored for the loader, so each name of the choice does. In an executable neither does: a-choice-of-written-names-asks-no-function-stored-for-the-loader.cjs

// RUN: lower
// OPTIONS: runs-tests builtin-modules
// CHECK-LABEL: function {{*}}name="choose"
// CHECK: = AreLoaderFunctionsStored
// CHECK: SwitchString
// CHECK: [[first]] = String string="./first.js"
// CHECK: = RequireDynamic [[first]]
// CHECK: [[second]] = String string="./second.js"
// CHECK: = RequireDynamic [[second]]

// FILE: main.cjs
const Module = require("node:module");
const original = Module.prototype.require;
Module.prototype.require = function (name) {
  return original.call(this, name);
};
function choose(flag) {
  return require(flag ? "./first.js" : "./second.js");
}
console.log(choose(process.argv.length > 99).value);

// FILE: first.js
module.exports = { value: 1 };

// FILE: second.js
module.exports = { value: 2 };
