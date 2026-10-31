// a typed ES package imports names of a CommonJS package through another package
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

import { callX } from "indirect";
console.log(callX());
