// RUN: lower

// A path inside a package brings in the file that it names, not the declarations of the package: `FromParts` and `FromScopedParts` name nothing, which stops no build, and their positions are untyped.
// What a file beside the importing ones declares globally is declared.
// CHECK: [[literal]] = Data
// CHECK-NEXT: Convert [[literal]] declared={type=undefined|null|[[FromTheTests]]
// CHECK: [[parts]] = Data
// CHECK-NEXT: [[scoped]] = Data
// CHECK-NOT: Convert [[parts]]
// CHECK-NOT: Convert [[scoped]]
// CHECK: PropGet [[parts]] key="a"
// CHECK-NEXT: PropGet [[scoped]] key="a"

// FILE: src/main.ts
const declared: FromTheTests = { a: 1 };
const parts: FromParts = { a: 2 };
const scoped: FromScopedParts = { a: 3 };
console.log(declared.a, parts.a, scoped.a);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: node_modules/parts/package.json
{"name":"parts","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/parts/index.js
exports.value = 1;

// FILE: node_modules/parts/index.d.ts
export declare const value: number;
declare global {
  interface FromParts {
    a: number;
  }
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
  interface FromScopedParts {
    a: number;
  }
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

// FILE: tests/globals.ts
declare global {
  interface FromTheTests {
    a: number;
  }
}
export {};
