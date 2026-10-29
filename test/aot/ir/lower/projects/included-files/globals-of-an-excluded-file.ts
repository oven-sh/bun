// RUN: lower
// DIAGNOSTIC: TS7017 src/uses.ts:2

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
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true},"exclude":["src/global.ts"]}
