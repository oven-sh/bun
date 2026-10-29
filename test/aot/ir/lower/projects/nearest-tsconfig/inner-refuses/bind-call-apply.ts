// RUN: lower
// DIAGNOSTIC: TS2345 inner/lib.ts:2

// FILE: main.ts
import "./inner/lib.ts";

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"strictBindCallApply":false}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true}}

// FILE: inner/lib.ts
function f(n: number) { return n; }
console.log(f.call(undefined, "x"));
