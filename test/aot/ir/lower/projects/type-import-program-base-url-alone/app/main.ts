// a type import that only the program's tsconfig.json resolves is found: through its baseUrl, and the nearest has none
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

declare const console: { log(...values: unknown[]): void };
import { next } from "../imports/app/mods/one/index";
console.log(next({ n: 1 }));
