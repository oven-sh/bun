// a file whose project needs another program than the entry point's is held to nothing that it declares: undefined for a number, in a file with the option below an entry point that lacks it
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: entry

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
