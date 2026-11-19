// The reader names members alone, so what `names.cjs` exports are variables and the file has no exports object: `true` stands in the place of `exports`.
// Folding has the answer of `typeof exports`. Whatever else may be asked of the mention, `true` answers as an object does.
// RUN: link
// CHECK: module [[file]] path="{{*}}/names.cjs"
// CHECK: function {{*}}module=[[file]] kind=CommonJsModule
// CHECK-NOT: = NewObject
// CHECK-NOT: = TypeOf
// CHECK: Return

// FILE: main.cjs
const names = require("./names.cjs");
console.log(names.not, names.isNull, names.kind, names.foo);

// FILE: names.cjs
exports.not = !exports;
exports.isNull = exports == null;
exports.kind = typeof (exports && 5);
var foo = function () {
  return "foo";
};
if (typeof exports === "object") {
  exports.foo = foo;
}
