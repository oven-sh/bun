// RUN: lower
// DIAGNOSTIC: UnprovenInt32 2

// An imported function and an imported class are followed across files.

// FILE: main.ts
import { half as halved, Cursor } from "./typed.ts";
const given: number[] = JSON.parse("[3]");
console.log(halved(given[0]!), new Cursor(given[0]!), [1].map(halved));

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
