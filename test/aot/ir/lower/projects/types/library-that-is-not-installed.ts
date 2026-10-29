// RUN: lower
// DIAGNOSTIC: TS2688 1

// A type library that `types` names and that is not installed is a warning.

// FILE: main.ts
console.log(1 + 1);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":["not-installed"],"strict":true}}
