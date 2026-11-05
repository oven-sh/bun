// a file under the aot condition that type checks keeps its types
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

import { area } from "shapes";
console.log(area(2));
