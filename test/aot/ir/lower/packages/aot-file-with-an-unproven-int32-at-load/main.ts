// an int32 that is not proven as the module of a file under the aot condition is evaluated
// RUN: link
// DIAGNOSTIC: Int32OfDependencyNotProven 1
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

import { area } from "shapes";
console.log(area(2));
