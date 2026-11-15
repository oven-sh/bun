// RUN: lower
// DIAGNOSTIC: TS2322 test/wrong.ts:2

// FILE: test/wrong.ts
import { value } from "../src/value.ts";
const text: string = value;
console.log(text);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","types":[],"strict":true,"outDir":"dist"},"include":["src"]}

// FILE: src/value.ts
export const value: number = 1;

// FILE: test/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","types":[],"strict":true,"outDir":"dist","rootDir":".."}}
