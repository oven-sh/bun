// RUN: link
// CHECK: module [[stores]] path="{{*}}stores.cjs"
// CHECK: module [[face]] path="#{{*}}requests=[{target=[[stores]] kind=Require
// CHECK: module {{*}}main.mjs" {{*}}requests=[{target=[[face]] completes=true isHoisted=true}, {target=[[face]] completes=true}]
// CHECK: = ModuleNamespace module=[[face]] phase=Defer
// CHECK-NEXT: = ModuleNamespace module=[[face]] @

// FILE: main.mjs
import "./stores.cjs";
import defer * as later from "./stores.cjs";
import * as now from "./stores.cjs";
console.log(later, now);

// FILE: stores.cjs
exports.then = 1;
