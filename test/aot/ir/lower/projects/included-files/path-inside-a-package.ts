// RUN: lower
// DIAGNOSTIC: TS2304 src/main.ts:1

// A path inside a package brings in the file that it names, not the declarations of the package.

// FILE: src/main.ts
console.log(typeof fromParts, typeof fromScopedParts);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: node_modules/parts/package.json
{"name":"parts","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/parts/index.js
exports.value = 1;

// FILE: node_modules/parts/index.d.ts
export declare const value: number;
declare global {
  var fromParts: number | undefined;
}

// FILE: node_modules/parts/first.js
exports.first = 1;

// FILE: node_modules/parts/second.js
exports.second = 2;

// FILE: node_modules/@scope/parts/package.json
{"name":"@scope/parts","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/@scope/parts/index.js
exports.value = 1;

// FILE: node_modules/@scope/parts/index.d.ts
export declare const value: number;
declare global {
  var fromScopedParts: number | undefined;
}

// FILE: node_modules/@scope/parts/deep/third.js
exports.third = 3;

// FILE: tests/one.ts
import { first } from "parts/first.js";
export const one = first;

// FILE: tests/two.ts
import { second } from "parts/second.js";
import { third } from "@scope/parts/deep/third.js";
export const two = [second, third];
