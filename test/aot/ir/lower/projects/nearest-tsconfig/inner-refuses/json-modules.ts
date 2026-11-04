// RUN: lower
// DIAGNOSTIC: TS2732 inner/lib.ts:1

// FILE: main.ts
import "./inner/lib.ts";

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"resolveJsonModule":false}}

// FILE: inner/lib.ts
import data from "./data.json";
console.log(data.a);

// FILE: inner/data.json
{ "a": 1 }
