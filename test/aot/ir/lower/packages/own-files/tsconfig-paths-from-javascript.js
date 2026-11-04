// RUN: lower
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceLinesOfPackages = 0
// CHECK: = Call {{*}}calleeName="f"

// A file of the program that is reached through the paths of the tsconfig.json is the program's own: it is checked, and it counts with the program, not with the packages.
// The type error in it is not reported and stops no build.

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
