// a build reports what `bun check` reports in the project of each file: undefined for a number, in a file without the option below an entry point that has it
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
