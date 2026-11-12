// RUN: lower
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 2
// CHECK-COUNT-2: = Call {{*}}calleeName="after"

// A package that says nothing has null checks on, so `let last: string = null` is a type error. It is not reported, and the file keeps its types.

// FILE: app.ts
import { after } from "lenient";
console.log(after("first"), after("second"));

// FILE: package.json
{"name":"app","private":true,"type":"module"}

// FILE: node_modules/lenient/package.json
{"name":"lenient","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}}}

// FILE: node_modules/lenient/index.js
let last = null;
export function after(name) {
  const before = last;
  last = name;
  return before;
}

// FILE: node_modules/lenient/index.aot.ts
let last: string = null;
export function after(name: string): string {
  const before: string = last;
  last = name;
  return before;
}
