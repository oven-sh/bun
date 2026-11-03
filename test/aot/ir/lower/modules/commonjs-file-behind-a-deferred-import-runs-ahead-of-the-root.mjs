// `import defer` puts off when a file runs, not when it is linked: the CommonJS file below it is asked for ahead of everything that the root of the graph writes.
// RUN: link
// CHECK: module [[stores]] path="{{*}}stores.cjs"
// CHECK: module [[face]] path="#{{*}}requests=[{target=[[stores]] kind=Require
// CHECK: module [[later]] path="{{*}}later.mjs"
// CHECK: module {{*}}main.mjs" {{*}}requests=[{target=[[face]] completes=true isHoisted=true}, {{*}}{target=[[later]] phase=Defer

// FILE: main.mjs
import defer * as later from "./later.mjs";
console.log(typeof later, (await import("./later.mjs")).value);

// FILE: later.mjs
export { value } from "./stores.cjs";

// FILE: stores.cjs
console.log("stores.cjs runs");
exports.value = 1;
