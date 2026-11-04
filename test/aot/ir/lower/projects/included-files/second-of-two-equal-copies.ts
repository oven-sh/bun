// RUN: lower

// Of two copies of one version of a package the first in the project stands for both, as for tsc. What the second declares globally is not declared: `FromSecondTwin` names nothing, which stops no build, and its position is untyped.
// CHECK: [[literal]] = Data
// CHECK-NEXT: Convert [[literal]] declared={type=undefined|null|[[FromFirstTwin]]
// CHECK: [[second]] = Data
// CHECK-NOT: Convert [[second]]
// CHECK: PropGet [[second]] key="a"

// FILE: src/main.ts
const first: FromFirstTwin = { a: 1 };
const second: FromSecondTwin = { a: 2 };
console.log(first.a, second.a);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: tests/first/node_modules/twin/package.json
{"name":"twin","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: tests/first/node_modules/twin/index.js
exports.value = 1;

// FILE: tests/first/node_modules/twin/index.d.ts
export declare const value: number;
declare global {
  interface FromFirstTwin {
    a: number;
  }
}

// FILE: tests/second/node_modules/twin/package.json
{"name":"twin","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: tests/second/node_modules/twin/index.js
exports.value = 1;

// FILE: tests/second/node_modules/twin/index.d.ts
export declare const value: number;
declare global {
  interface FromSecondTwin {
    a: number;
  }
}

// FILE: tests/first/uses.ts
import { value } from "twin";
export const first = value;

// FILE: tests/second/uses.ts
import { value } from "twin";
export const second = value;
