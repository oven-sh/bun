// a package with a tsconfig.json of its own keeps its types
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { first } from "inner";
console.log(first([]), first([4]));
