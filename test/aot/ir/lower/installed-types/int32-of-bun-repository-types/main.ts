// int32 of "bun" is a 32-bit integer
// RUN: link
// DIAGNOSTIC: UnprovenInt32 1
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import type { int32 } from "bun";
import { inspect } from "bun";
declare const console: { log(...values: unknown[]): void };
type Inline = import("bun").int32;
function half(n: int32): number {
  return n / 2;
}
function twice(n: Inline): number {
  return n * 2;
}
const given: number[] = JSON.parse("[4, 1.5]");
for (const n of given) console.log(half(n | 0), twice(n));
console.log(typeof inspect);
