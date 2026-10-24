// RUN: lower
// CHECK: function {{*}}kind=Module
// CHECK: EvaluateModule module=[[below]] referrer=[[entry]] [isBare]
// CHECK: [[c]] = GetModuleVariable
// CHECK: = Add
// CHECK: PutModuleVariable

// RUN(F): lower
// F-LABEL: function {{*}}name="f"
// F: [[callee]] = GetModuleVariable
// F: [[receiver]] = ModuleNamespace module=m
// F: = Call {{*}}[[receiver]]
// F: Return

// RUN(NOWHERE): lower
// NOWHERE-NOT: RequireModule
// NOWHERE-NOT: = PropGet

// RUN(RECORDS): link
// RECORDS: module {{*}}require-of-an-es-module-at-the-top{{*}}requests=[{target=m{{*}}kind=Require completes=true}]

// `require("./m.mjs")` at the top of a file is a synchronous import at that point. The constant holds nothing but its dead zone, and its members are the variables of the other module, as those of `import * as a` are.
const a = require("./imports/chain/m0.mjs");
export const c = a.c + 1;
export function f(x) {
  return x & 1 ? a.f(x) + c : c;
}
