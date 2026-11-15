// A read of `later.value` asks the object of front.mjs, so the file has a record though its package declares no side effects and the name only passes through it.
// RUN: link
// CHECK: module [[source]] path="{{*}}source.mjs"
// CHECK: module [[front]] path="{{*}}front.mjs" {{*}}requests=[{target=[[source]] {{*}}exports=[{name="value"
// CHECK: module {{*}}main.mjs" {{*}}requests=[{target=[[front]] phase=Defer
// CHECK: ModuleNamespace module=[[front]] phase=Defer @

// FILE: main.mjs
import defer * as later from "./front.mjs";
console.log(later.value);

// FILE: front.mjs
export * from "./source.mjs";

// FILE: source.mjs
export const value = "value";

// FILE: package.json
{ "name": "without-side-effects", "sideEffects": false }
