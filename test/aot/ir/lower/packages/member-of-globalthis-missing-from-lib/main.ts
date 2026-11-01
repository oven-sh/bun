// a package that reads a member of globalThis that the application's lib does not declare stays typed
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { half, title } from "ships-typescript";
declare const console: { log(...values: unknown[]): void };
console.log(title(), half(4));
