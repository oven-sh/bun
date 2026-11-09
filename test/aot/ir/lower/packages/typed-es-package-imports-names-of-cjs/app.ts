// a typed ES package imports names of a CommonJS package
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { callX } from "names";
console.log(callX());
