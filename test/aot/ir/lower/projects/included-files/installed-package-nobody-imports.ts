// RUN: lower
// DIAGNOSTIC: TS2552 src/main.ts:1

// FILE: src/main.ts
console.log(typeof fromImported, typeof fromInstalled);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: node_modules/imported/package.json
{"name":"imported","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/imported/index.js
exports.value = 1;

// FILE: node_modules/imported/index.d.ts
export declare const value: number;
declare global {
  var fromImported: number | undefined;
}

// FILE: node_modules/installed/package.json
{"name":"installed","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/installed/index.js
exports.value = 1;

// FILE: node_modules/installed/index.d.ts
export declare const value: number;
declare global {
  var fromInstalled: number | undefined;
}

// FILE: tests/setup.ts
import { value } from "imported";
export const one = value;
