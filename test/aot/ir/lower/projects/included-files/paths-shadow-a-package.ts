// RUN: lower
// DIAGNOSTIC: TS2304 src/main.ts:1

// A name that `paths` leads elsewhere does not stand for the installed package.

// FILE: src/main.ts
console.log(typeof fromShadowed);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[],"paths":{"shadowed":["./src/local.ts"],"shadowed/*":["./src/*"]}},"include":["src","tests"]}

// FILE: node_modules/shadowed/package.json
{"name":"shadowed","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/shadowed/index.js
exports.value = 1;

// FILE: node_modules/shadowed/index.d.ts
export declare const value: number;
declare global {
  var fromShadowed: number | undefined;
}

// FILE: src/local.ts
export const value = 1;

// FILE: tests/setup.ts
import { value } from "shadowed";
import { value as again } from "shadowed/local.ts";
export const both = [value, again];
