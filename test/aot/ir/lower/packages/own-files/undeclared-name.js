// RUN: lower
// DIAGNOSTIC: TS2304 lib/f.ts:2

// FILE: main.js
import { f } from "#lib/f.ts";
console.log(f());

// FILE: package.json
{"name":"app","version":"1.0.0","type":"module","imports":{"#lib/*":"./lib/*"}}

// FILE: lib/f.ts
export function f(): number {
  return typeof missing === "undefined" ? 1 : 2;
}
