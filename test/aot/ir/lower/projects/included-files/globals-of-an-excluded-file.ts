// RUN: lower

// A tsconfig.json without `include` takes every file below it but those that `exclude` lists. What such a file declares globally is not declared: `Excluded` names nothing, which stops no build, and its position is untyped.
// CHECK: [[literal]] = Data
// CHECK-NEXT: Convert [[literal]] declared={type=undefined|null|[[Taken]]
// CHECK: [[excluded]] = Data
// CHECK-NOT: Convert [[excluded]]
// CHECK: PropGet [[excluded]] key="value"

// FILE: src/uses.ts
const taken: Taken = { value: 1 };
const excluded: Excluded = { value: 2 };
export const both = [taken.value, excluded.value];

// FILE: src/taken.ts
declare global {
  interface Taken {
    value: number;
  }
}
export {};

// FILE: src/global.ts
declare global {
  interface Excluded {
    value: number;
  }
}
export {};

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true},"exclude":["src/global.ts"]}
