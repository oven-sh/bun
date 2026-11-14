// RUN: lower

// FILE: main.ts
import "./inner/lib.ts";

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"noImplicitAny":false}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"allowJs":true,"noImplicitAny":false}}

// FILE: inner/lib.ts
import { f } from "./between.ts";
console.log(f(1));

// FILE: inner/between.ts
export * from "./code.js";

// FILE: inner/code.js
export function f(x) { return x; }
