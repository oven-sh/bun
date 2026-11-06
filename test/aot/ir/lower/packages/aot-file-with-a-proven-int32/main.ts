// an int32 that is proven in a file under the aot condition
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

import { area } from "shapes";
console.log(area(2));
