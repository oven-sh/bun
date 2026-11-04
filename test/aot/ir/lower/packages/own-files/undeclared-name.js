// RUN: lower
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceLinesOfPackages = 0
// CHECK: = Call {{*}}calleeName="f"

// A name that nothing declares, in a file of the program that is reached through an alias, is not reported and stops no build. The file stays checked.

// FILE: main.js
import { f } from "#lib/f.ts";
console.log(f());

// FILE: package.json
{"name":"app","version":"1.0.0","type":"module","imports":{"#lib/*":"./lib/*"}}

// FILE: lib/f.ts
export function f(): number {
  return typeof missing === "undefined" ? 1 : 2;
}
