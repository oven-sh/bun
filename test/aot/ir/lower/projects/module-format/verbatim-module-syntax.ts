// RUN: lower

// What verbatimModuleSyntax forbids in a CommonJS file (TS1287, TS1295) keeps no program from running, so no build reports it. The import and the export are lowered as they are written.

// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[read]] = GetModuleVariable variable=[[one]]
// CHECK-NEXT: = CheckInitialized [[read]] name="one"
// CHECK: PutModuleVariable {{*}}variable=[[two]]

// FILE: main.ts
import { one } from "./other.js";
export const two = one + 1;
console.log(two);

// FILE: other.ts
export const one = 1;

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"Node16","moduleResolution":"Node16","verbatimModuleSyntax":true}}
