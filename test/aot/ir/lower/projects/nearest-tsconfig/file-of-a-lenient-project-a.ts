// RUN: lower
// ENTRY: a-strict/other.ts lib/own.ts

// A file that two projects import is checked under its own.

// FILE: lib/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"strictPropertyInitialization":false}}

// FILE: lib/box.ts
export class Box {
  value: number;
  set(value: number) { this.value = value; return this; }
}

// FILE: lib/own.ts
import { Box } from "./box";
console.log(new Box().set(1).value);

// FILE: a-strict/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}

// FILE: a-strict/other.ts
import { Box } from "../lib/box";
console.log(new Box().set(1).value);
