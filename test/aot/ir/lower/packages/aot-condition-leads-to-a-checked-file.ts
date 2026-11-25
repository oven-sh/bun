// RUN: lower
// STATISTIC: SourceFilesChecked = 2
// CHECK: [[add]] = CheckInitialized {{*}}name="add"
// CHECK-NEXT: [[one]] = Integer integer=1
// CHECK-NEXT: [[text]] = String string="2"
// CHECK-NEXT: [[sum]] = Call [[add]], -, [[one]], [[text]] calleeName="add"
// CHECK-NEXT: PutModuleVariable [[sum]]

// The import leads to the file under the aot condition, which is checked as its importer is.
// An argument that does not fit the parameter is not reported and not converted, and neither is the result: the callee tests what arrives and what it returns.

// FILE: main.ts
import { add } from "adder"; // @ts-expect-error
export const sum = add(1, "2");

// FILE: tsconfig.json
{"compilerOptions":{"module":"preserve","moduleResolution":"bundler","strict":true,"noEmit":true,"types":[]}}

// FILE: node_modules/adder/package.json
{"name":"adder","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}}}

// FILE: node_modules/adder/index.js
export function add(a, b) {
  return a + b;
}

// FILE: node_modules/adder/index.aot.ts
export function add(a: number, b: number): number {
  return a + b;
}
