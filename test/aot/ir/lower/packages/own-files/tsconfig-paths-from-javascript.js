// RUN: lower
// DIAGNOSTIC: TS2322 lib/f.ts:2

// FILE: main.js
import { f } from "@lib/f.ts";
console.log(f());

// FILE: package.json
{"name":"app","version":"1.0.0","type":"module"}

// FILE: tsconfig.json
{"files":[],"compilerOptions":{"module":"preserve","moduleResolution":"bundler","allowImportingTsExtensions":true,"noEmit":true,"types":[],"paths":{"@lib/*":["./lib/*"]}}}

// FILE: lib/f.ts
export function f(): number {
  return "x";
}
