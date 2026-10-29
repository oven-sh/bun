// RUN: lower

// A function that nothing calls is not in the program, so what it promises is not asked for.

// FILE: main.ts
import type { int32 } from "bun";
function unused(n: number): int32 {
  return n;
}
console.log("built");

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","allowImportingTsExtensions":true,"types":[],"noEmit":true},"files":["bun.d.ts"]}

// FILE: bun.d.ts
declare module "bun" {
  type int32 = number & { readonly "bun.int32"?: true };
}
