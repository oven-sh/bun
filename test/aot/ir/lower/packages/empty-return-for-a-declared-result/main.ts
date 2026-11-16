// a package that ships its TypeScript stays typed where a function with a declared result has an empty return
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { half } from "ships-typescript";
const none: number = half(-4);
console.log(half(4), typeof none, none + 1);
