// RUN: lower

// A module object hands out the functions of its module as values.

// FILE: main.ts
import * as typed from "./typed.ts";
console.log(typed.half(3), Object.keys(typed), Object.keys(await import("./typed.ts")));

// FILE: typed.ts
import type { int32 } from "bun";
export function half(n: int32): number {
  return n / 2;
}
export class Cursor {
  constructor(public line: int32) {}
}

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","allowImportingTsExtensions":true,"types":[],"noEmit":true},"files":["bun.d.ts"]}

// FILE: bun.d.ts
declare module "bun" {
  type int32 = number & { readonly "bun.int32"?: true };
}
