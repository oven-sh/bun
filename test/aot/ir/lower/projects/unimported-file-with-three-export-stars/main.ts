// a file of the project that nobody imports may hand on everything of three modules
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { a } from "./imports/a";
import { b } from "./imports/b";
import { c } from "./imports/c";
console.log(a + b + c);
