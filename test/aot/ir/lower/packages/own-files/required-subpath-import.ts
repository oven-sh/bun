// RUN: lower
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceLinesOfPackages = 0
// CHECK: EvaluateModule {{*}}isCallOfRequire
// CHECK: [[f]] = CheckInitialized {{*}}name="f"
// CHECK: = Call [[f]] calleeName="f"

// A file of the program that require() reaches through an alias is the program's own: it is checked, and it counts with the program, not with the packages.
// The type error in it is not reported and stops no build.

// FILE: main.ts
declare const console: { log(...values: unknown[]): void };
declare function require(name: string): any;
const { f } = require("#lib/f.ts");
console.log(f());

// FILE: package.json
{"name":"app","version":"1.0.0","type":"module","imports":{"#lib/*":"./lib/*"}}

// FILE: lib/f.ts
export function f(): number {
  return "x";
}
