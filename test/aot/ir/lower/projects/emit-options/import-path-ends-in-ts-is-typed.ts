// RUN: lower

// What is imported by a path that ends in .ts has the type that its file declares: `typeof value` is `number`. That the number does not fit `string` stops no build.
// CHECK: CheckInitialized {{*}}name="value"
// CHECK-NEXT: [[first]] = Integer integer=1
// CHECK-NEXT: Convert [[first]] declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK: CheckInitialized {{*}}name="value"
// CHECK-NEXT: [[second]] = Integer integer=1
// CHECK-NEXT: Convert [[second]] declared={type=number}

// FILE: test/wrong.ts
import { value } from "../src/value.ts";
const text: string = value;
const copy: typeof value = value;
console.log(text, copy);

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","types":[],"strict":true,"outDir":"dist"},"include":["src"]}

// FILE: src/value.ts
export const value: number = 1;

// FILE: test/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","types":[],"strict":true,"outDir":"dist","rootDir":".."}}
