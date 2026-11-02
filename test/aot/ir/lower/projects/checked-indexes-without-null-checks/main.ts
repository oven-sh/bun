// a build reports what `bun check` reports in the project of each file: an element for a number, under noUncheckedIndexedAccess without strictNullChecks
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
