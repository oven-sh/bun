// a typed ES package exports a name of a CommonJS package again
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { callX } from "reexport";
console.log(callX());
