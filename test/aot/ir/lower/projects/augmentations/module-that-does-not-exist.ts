// RUN: lower
// DIAGNOSTIC: TS2664 missing.ts:1

// FILE: missing.ts
declare module "./nowhere" {
  interface Variables {
    other?: string;
  }
}
export {};

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}
