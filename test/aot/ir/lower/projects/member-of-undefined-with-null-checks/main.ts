// a file whose project needs another program than the entry point's is held to nothing that it declares: a member of what may be undefined, in a file with the option below an entry point that lacks it
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: entry

import { size } from "./imports/inner/lib.ts";
console.log(size("a"));
