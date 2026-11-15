// a package whose tsconfig.json needs another program than the entry point's is held to nothing that it declares, like a folder of the program
// RUN: link
// STATISTIC: SourceFilesDemoted = 2
// CHECK: entry

import { first } from "inner";
import { last } from "./imports/mine/lib.ts";
console.log(first([]), first([4]), last([]), last([5]));
