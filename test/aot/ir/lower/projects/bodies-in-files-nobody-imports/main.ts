// what stands in the bodies of functions in files that nobody imports
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { a } from "./imports/a";
console.log(a);
