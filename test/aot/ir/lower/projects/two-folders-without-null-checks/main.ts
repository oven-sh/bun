// a file whose project needs another program than the entry point's is held to nothing that it declares: two folders without the option
// RUN: link
// STATISTIC: SourceFilesDemoted = 2
// CHECK: entry

import { first } from "./imports/one/lib.ts";
import { twice } from "./imports/two/lib.ts";
console.log(first([]), twice(2), twice(0));
