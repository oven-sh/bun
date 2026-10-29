// RUN: lower
// DIAGNOSTIC: TS2584 inner/lib.ts:1

// FILE: main.ts
import { value } from "./inner/lib.ts";
(globalThis as any).console.log(value);

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"lib":["esnext","dom"]}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"lib":["esnext"]}}

// FILE: inner/lib.ts
export const value = typeof document;
