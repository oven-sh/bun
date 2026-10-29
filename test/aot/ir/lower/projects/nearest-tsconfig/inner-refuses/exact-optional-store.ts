// RUN: lower
// DIAGNOSTIC: TS2412 inner/lib.ts:2

// FILE: main.ts
import "./inner/lib.ts";

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"exactOptionalPropertyTypes":true}}

// FILE: inner/lib.ts
const o: { a?: number } = {};
o.a = undefined;
console.log(o);
