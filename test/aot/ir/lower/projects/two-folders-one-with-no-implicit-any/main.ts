// a build reports what `bun check` reports in the project of each file: two folders without the option, one of them with noImplicitAny
// RUN: link
// DIAGNOSTIC: TS7006 1
// STATISTIC: SourceFilesDemoted = 0

import { first } from "./imports/one/lib.ts";
import { twice } from "./imports/two/lib.ts";
console.log(first([]), twice(2));
