// a file whose project needs another program than the entry point's is held to nothing that it declares: a string for a number, which its own project refuses too
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: entry

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
