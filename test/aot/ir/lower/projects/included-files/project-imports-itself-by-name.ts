// RUN: lower
// DIAGNOSTIC: TS2304 src/main.ts:1

// A project that imports itself by its own name is no installed package.

// FILE: src/main.ts
console.log(typeof fromItself);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: package.json
{"name":"itself","version":"1.0.0","types":"index.d.ts","exports":{"./*":"./*"}}

// FILE: index.d.ts
export declare const value: number;
declare global {
  var fromItself: number | undefined;
}

// FILE: src/library.ts
export const value = 1;

// FILE: tests/setup.ts
import { value } from "itself/src/library.ts";
export const one = value;
