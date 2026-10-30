// RUN: lower
// ENTRY: test/outside.ts

// rootDir says where tsc writes its output: a file outside it is no error.

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"outDir":"./dist","rootDir":"./src"},"include":["./src/**/*.ts"]}

// FILE: src/one.ts
export const one: number = 1;

// FILE: src/beside.ts
import { one } from "./one";
console.log(one);

// FILE: test/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"outDir":"./dist","rootDir":"."},"include":["."]}

// FILE: test/outside.ts
import { one } from "../src/one";
declare global {
  var marker: number | undefined;
}
console.log(one, globalThis.marker);
