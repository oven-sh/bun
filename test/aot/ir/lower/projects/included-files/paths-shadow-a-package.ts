// RUN: lower

// A name that `paths` leads elsewhere does not stand for the installed package: `FromShadowed` names nothing, which stops no build, and its position is untyped.
// What a file beside the importing one declares globally is declared.
// CHECK: [[literal]] = Data
// CHECK-NEXT: Convert [[literal]] declared={type=undefined|null|[[FromTheTests]]
// CHECK: [[shadowed]] = Data
// CHECK-NOT: Convert [[shadowed]]
// CHECK: PropGet [[shadowed]] key="a"

// FILE: src/main.ts
const declared: FromTheTests = { a: 1 };
const shadowed: FromShadowed = { a: 2 };
console.log(declared.a, shadowed.a);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[],"paths":{"shadowed":["./src/local.ts"],"shadowed/*":["./src/*"]}},"include":["src","tests"]}

// FILE: node_modules/shadowed/package.json
{"name":"shadowed","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/shadowed/index.js
exports.value = 1;

// FILE: node_modules/shadowed/index.d.ts
export declare const value: number;
declare global {
  interface FromShadowed {
    a: number;
  }
}

// FILE: src/local.ts
export const value = 1;

// FILE: tests/setup.ts
import { value } from "shadowed";
import { value as again } from "shadowed/local.ts";
export const both = [value, again];

// FILE: tests/globals.ts
declare global {
  interface FromTheTests {
    a: number;
  }
}
export {};
