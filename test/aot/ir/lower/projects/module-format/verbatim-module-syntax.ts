// RUN: lower
// DIAGNOSTIC: TS1287 main.ts:2
// DIAGNOSTIC: TS1287 other.ts:1
// DIAGNOSTIC: TS1295 main.ts:1

// verbatimModuleSyntax is asked for by name: what it forbids in a CommonJS file is reported.

// FILE: main.ts
import { one } from "./other.js";
export const two = one + 1;
console.log(two);

// FILE: other.ts
export const one = 1;

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"Node16","moduleResolution":"Node16","verbatimModuleSyntax":true}}
