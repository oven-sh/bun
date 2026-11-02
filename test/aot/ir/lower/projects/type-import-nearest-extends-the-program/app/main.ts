// a type import that only the program's tsconfig.json resolves is found: the nearest extends it and has paths of its own
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

declare const console: { log(...values: unknown[]): void };
import { next } from "../imports/app/mods/one/index";
console.log(next({ n: 1 }));
