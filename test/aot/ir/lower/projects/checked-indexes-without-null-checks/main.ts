// a file whose project needs another program than the entry point's is held to nothing that it declares: an element for a number, under noUncheckedIndexedAccess without strictNullChecks
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: entry

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
