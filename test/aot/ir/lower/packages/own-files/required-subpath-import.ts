// RUN: lower
// DIAGNOSTIC: TS2322 lib/f.ts:2

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
