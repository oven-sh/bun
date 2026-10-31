// RUN: lower
// DIAGNOSTIC: TS2304 main.ts:1
// DIAGNOSTIC: TS2688 1

// FILE: main.ts
const value: DeclaredThere = { a: 1 };
console.log(value.a);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":["not-installed"],"strict":true}}
