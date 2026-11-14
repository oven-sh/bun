// RUN: lower
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceLinesOfPackages = 3
// CHECK: = Call {{*}}calleeName="f"

// A subpath import that maps to an installed package is a dependency: its file counts with the packages.
// The type error in it is not reported, and the file keeps its types.

// FILE: main.js
import { f } from "#dep";
console.log(f());

// FILE: package.json
{"name":"app","version":"1.0.0","type":"module","imports":{"#dep":"dep"}}

// FILE: node_modules/dep/package.json
{"name":"dep","version":"1.0.0","type":"module","exports":"./index.ts"}

// FILE: node_modules/dep/index.ts
export function f(): number {
  return "x";
}
