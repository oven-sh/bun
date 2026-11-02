// a typed ES package imports the default of a CommonJS package
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

import { callX } from "default";
console.log(callX());
