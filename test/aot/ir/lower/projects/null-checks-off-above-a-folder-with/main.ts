// a file whose project needs another program than the entry point's is held to nothing that it declares: what may be undefined for a number, in a folder without the option above one with it, which keeps its types
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: entry

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
