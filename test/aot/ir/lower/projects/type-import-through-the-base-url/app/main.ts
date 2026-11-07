// a type import through the program's baseUrl
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

declare const console: { log(...values: unknown[]): void };
import { next } from "../imports/app/mods/one/index";
console.log(next({ n: 1 }));
