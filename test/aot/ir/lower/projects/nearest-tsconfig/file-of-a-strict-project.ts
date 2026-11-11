// RUN: lower
// DIAGNOSTIC: TS2564 lib/box.ts:2

// FILE: lenient/other.ts
import { Box } from "../lib/box";
console.log(new Box().set(1).value);

// FILE: lenient/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"strictPropertyInitialization":false}}

// FILE: lib/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}

// FILE: lib/box.ts
export class Box {
  value: number;
  set(value: number) { this.value = value; return this; }
}
