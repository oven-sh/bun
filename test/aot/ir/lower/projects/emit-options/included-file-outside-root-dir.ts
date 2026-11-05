// RUN: lower
// DIAGNOSTIC: TS2322 src/wrong.ts:1

// A file of the project outside rootDir does not keep the rest from being type checked.

// FILE: src/main.ts
import { wrong } from "./wrong";
export const main = wrong;

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"outDir":"./dist","rootDir":"./src"},"include":["src","test"]}

// FILE: src/wrong.ts
export const wrong: number = "text";

// FILE: test/setup.ts
declare global {
  var marker: number | undefined;
}
export {};
