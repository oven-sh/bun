// RUN: lower
// DIAGNOSTIC: TS100009 1

// A subpath import that maps to an installed package is a dependency.

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
