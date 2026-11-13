// a type import through paths that the nearest tsconfig.json inherits
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

declare const console: { log(...values: unknown[]): void };
import { next } from "../imports/app/mods/one/index";
console.log(next({ n: 1 }));
