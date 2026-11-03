// a build reports what `bun check` reports in the project of each file: two folders without the option
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { first } from "./imports/one/lib.ts";
import { twice } from "./imports/two/lib.ts";
console.log(first([]), twice(2), twice(0));
