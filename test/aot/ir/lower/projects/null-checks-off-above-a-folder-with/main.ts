// a build reports what `bun check` reports in the project of each file: what may be undefined for a number, in a folder without the option above one with it
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
