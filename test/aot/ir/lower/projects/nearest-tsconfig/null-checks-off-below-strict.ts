// RUN: lower
// ENTRY: strict/main.ts

// FILE: strict/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}

// FILE: strict/main.ts
import { nothing } from "../lax/lax";
console.log(nothing);

// FILE: strict/none.ts
export const none: number = null;

// FILE: lax/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":false}}

// FILE: lax/main.ts
import { none } from "../strict/none";
console.log(none);

// FILE: lax/lax.ts
export const nothing: number = null;
