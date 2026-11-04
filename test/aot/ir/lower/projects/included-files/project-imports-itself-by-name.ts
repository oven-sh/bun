// RUN: lower

// A project that imports itself by its own name is no installed package: `FromItself` names nothing, which stops no build, and its position is untyped.
// What a file beside the importing one declares globally is declared.
// CHECK: [[literal]] = Data
// CHECK-NEXT: Convert [[literal]] declared={type=undefined|null|[[FromTheTests]]
// CHECK: [[itself]] = Data
// CHECK-NOT: Convert [[itself]]
// CHECK: PropGet [[itself]] key="a"

// FILE: src/main.ts
const declared: FromTheTests = { a: 1 };
const itself: FromItself = { a: 2 };
console.log(declared.a, itself.a);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: package.json
{"name":"itself","version":"1.0.0","types":"index.d.ts","exports":{"./*":"./*"}}

// FILE: index.d.ts
export declare const value: number;
declare global {
  interface FromItself {
    a: number;
  }
}

// FILE: src/library.ts
export const value = 1;

// FILE: tests/setup.ts
import { value } from "itself/src/library.ts";
export const one = value;

// FILE: tests/globals.ts
declare global {
  interface FromTheTests {
    a: number;
  }
}
export {};
