// RUN: lower

// An import path that ends in .ts needs no allowImportingTsExtensions: Bun finds the file.

// FILE: main.ts
import { value } from "./src/value.ts";
console.log(value);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","types":[],"strict":true,"outDir":"dist"},"include":["src"]}

// FILE: src/value.ts
export const value: number = 1;
