// DIAGNOSTIC: TS100096 a-call-that-names-create-require-vouches-for-what-it-makes.cjs:22
// RUN: lower
// OPTIONS: builtin-modules
// Where code may come from disk, a require() is the program's only where compiled code names createRequire(): there the real one is handed, as `this`, a function that no program comes by.
// CHECK-LABEL: function {{*}}name="made"
// CHECK: [[real]] = Builtin builtin=NodeModuleCreateRequire
// CHECK-NEXT: [[isReal]] = StrictEq {{*}}, [[real]]
// CHECK-NEXT: Branch [[isReal]] -> taken [[byReal]](), notTaken [[called]]({{*}})
// CHECK: [[byReal]]():
// CHECK-NEXT: [[word]] = Builtin builtin=PrivateGlobalsCreateCommonJSModule
// CHECK-NEXT: Jump -> next [[called]]([[word]])
// CHECK: [[called]]([[this]]):
// CHECK: = Call {{*}}, [[this]], {{*}}calleeName="createRequire"
// CHECK-LABEL: function {{*}}name="ofTheSameName"
// CHECK-NOT: PrivateGlobalsCreateCommonJSModule
// CHECK-LABEL: function {{*}}name="whateverIsHanded"
// CHECK-NOT: PrivateGlobalsCreateCommonJSModule
"use strict";
const { createRequire } = require("node:module");

function made(path) {
  return createRequire(path);
}
function ofTheSameName(path, createRequire) {
  return createRequire(path);
}
function whateverIsHanded(path, hooks) {
  return hooks.map(hook => hook(path));
}
module.exports = { made, ofTheSameName, whateverIsHanded };
