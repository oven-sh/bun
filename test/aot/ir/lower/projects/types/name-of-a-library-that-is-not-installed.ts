// RUN: lower
// DIAGNOSTIC: TS2688 1

// A name that only the missing library declares stops no build. An annotation with it says nothing: no Convert stands behind the literal.

// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[value]] = Data
// CHECK-NOT: Convert [[value]]
// CHECK: = PropGet [[value]] key="a"

// FILE: main.ts
const value: DeclaredThere = { a: 1 };
console.log(value.a);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":["not-installed"],"strict":true}}
