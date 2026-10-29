// RUN: lower
// DIAGNOSTIC: TS2304 src/main.ts:1

// FILE: src/main.ts
console.log(typeof fromSecondTwin);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: tests/first/node_modules/twin/package.json
{"name":"twin","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: tests/first/node_modules/twin/index.js
exports.value = 1;

// FILE: tests/first/node_modules/twin/index.d.ts
export declare const value: number;
declare global {
  var fromFirstTwin: number | undefined;
}

// FILE: tests/second/node_modules/twin/package.json
{"name":"twin","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: tests/second/node_modules/twin/index.js
exports.value = 1;

// FILE: tests/second/node_modules/twin/index.d.ts
export declare const value: number;
declare global {
  var fromSecondTwin: number | undefined;
}

// FILE: tests/first/uses.ts
import { value } from "twin";
export const first = value;

// FILE: tests/second/uses.ts
import { value } from "twin";
export const second = value;
