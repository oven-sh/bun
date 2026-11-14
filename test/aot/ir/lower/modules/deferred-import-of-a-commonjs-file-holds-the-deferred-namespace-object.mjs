// RUN: link
// CHECK: module [[stores]] path="{{*}}stores.cjs"
// CHECK: module [[facade]] path="#{{*}}requests=[{target=[[stores]] kind=Require
// CHECK: module {{*}}main.mjs" {{*}}requests=[{target=[[facade]] completes=true isHoisted=true}, {target=[[facade]] completes=true}]
// CHECK: = ModuleNamespace module=[[facade]] phase=Defer
// CHECK-NEXT: = ModuleNamespace module=[[facade]] @

// FILE: main.mjs
import "./stores.cjs";
import defer * as later from "./stores.cjs";
import * as now from "./stores.cjs";
console.log(later, now);

// FILE: stores.cjs
exports.then = 1;
