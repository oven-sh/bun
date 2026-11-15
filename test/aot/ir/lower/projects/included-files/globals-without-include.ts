// RUN: lower

// A tsconfig.json without `include` takes every file below it: what one of them declares globally is declared.

// FILE: src/uses.ts
export function setting(): number {
  return globalThis.SETTING ?? 0;
}

// FILE: src/global.ts
declare global {
  var SETTING: number | undefined;
}
export {};

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}
