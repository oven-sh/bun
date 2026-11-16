// `createRequire(new URL("file:" + __filename).href)`: a call made the base, so it is asked at run time whether it still names the folder of the file, and a load
// through the require has a second arm: the call as written. Such a load is no proven call: a member of its answer is read off the value that either arm gives,
// not off the export of the file that the build found.
// RUN: lower
// CHECK: = Builtin builtin=WeakSetPrototypeHas
// CHECK: EvaluateModule
// CHECK: Jump -> next [[joined]]([[own]])
// CHECK: [[other]] = Call {{*}}calleeName="load"
// CHECK-NEXT: Jump -> next [[joined]]([[other]])
// CHECK-NEXT: [[joined]]([[loaded]]):
// CHECK-NEXT: = PropGet [[loaded]] key="name"

// FILE: main.cjs
var m = require("module");
var load = m.createRequire(new URL("file:" + __filename).href);
console.log(load("./sub.js").name);

// FILE: sub.js
exports.name = "sub";
