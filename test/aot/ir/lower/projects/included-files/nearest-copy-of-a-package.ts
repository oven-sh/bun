// RUN: lower

// FILE: src/main.ts
console.log(typeof fromFirstTwin, typeof fromSecondTwin, typeof fromOuterTwin);

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
{"name":"twin","version":"2.0.0","main":"index.js","types":"index.d.ts"}

// FILE: tests/second/node_modules/twin/index.js
exports.value = 1;

// FILE: tests/second/node_modules/twin/index.d.ts
export declare const value: number;
declare global {
  var fromSecondTwin: number | undefined;
}

// FILE: node_modules/twin/package.json
{"name":"twin","version":"3.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/twin/index.js
exports.value = 1;

// FILE: node_modules/twin/index.d.ts
export declare const value: number;
declare global {
  var fromOuterTwin: number | undefined;
}

// FILE: tests/first/uses.ts
import { value } from "twin";
export const first = value;

// FILE: tests/second/uses.ts
import { value } from "twin";
export const second = value;

// FILE: tests/uses.ts
import { value } from "twin";
export const third = value;
