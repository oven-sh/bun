// a package whose tsconfig.json needs another program than the entry point's is held to nothing that it declares, and the build says nothing of it
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: entry

import { first } from "inner";
console.log(first([]), first([4]));
