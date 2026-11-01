// RUN: lower

// A package with an "aot" condition and no declaration file, in a strict project.

// FILE: main.ts
import { add } from "adder";
export const sum = add(1, 2);

// FILE: tsconfig.json
{"compilerOptions":{"module":"preserve","moduleResolution":"bundler","strict":true,"noEmit":true,"types":[]}}

// FILE: node_modules/adder/package.json
{"name":"adder","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}}}

// FILE: node_modules/adder/index.js
export function add(a, b) {
  return a + b;
}

// FILE: node_modules/adder/index.aot.ts
export function add(a: number, b: number): number {
  return a + b;
}
