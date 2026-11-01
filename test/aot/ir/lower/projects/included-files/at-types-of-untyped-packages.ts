// RUN: lower

// FILE: src/main.ts
console.log(typeof fromTypesOfUntyped, typeof fromTypesOfScopedUntyped);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: node_modules/untyped/package.json
{"name":"untyped","version":"1.0.0","main":"index.js"}

// FILE: node_modules/untyped/index.js
exports.value = 1;

// FILE: node_modules/@types/untyped/package.json
{"name":"@types/untyped","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/@types/untyped/index.js
exports.value = 1;

// FILE: node_modules/@types/untyped/index.d.ts
export declare const value: number;
declare global {
  var fromTypesOfUntyped: number | undefined;
}

// FILE: node_modules/@scope/untyped/package.json
{"name":"@scope/untyped","version":"1.0.0","main":"index.js"}

// FILE: node_modules/@scope/untyped/index.js
exports.value = 1;

// FILE: node_modules/@types/scope__untyped/package.json
{"name":"@types/scope__untyped","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/@types/scope__untyped/index.js
exports.value = 1;

// FILE: node_modules/@types/scope__untyped/index.d.ts
export declare const value: number;
declare global {
  var fromTypesOfScopedUntyped: number | undefined;
}

// FILE: tests/setup.ts
import { value } from "untyped";
import { value as scoped } from "@scope/untyped/index.js";
export const both = [value, scoped];
