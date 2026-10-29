// a typed ES package reads import.meta.main
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

import { callX } from "main";
console.log(callX());
