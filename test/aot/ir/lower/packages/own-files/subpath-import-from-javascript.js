// RUN: lower
// DIAGNOSTIC: TS2322 lib/f.ts:2

// A file of the program that is reached through an alias is the program's own: a type error in it stops the build.

// FILE: main.js
import { f } from "#lib/f.ts";
console.log(f());

// FILE: package.json
{"name":"app","version":"1.0.0","type":"module","imports":{"#lib/*":"./lib/*"}}

// FILE: lib/f.ts
export function f(): number {
  return "x";
}
