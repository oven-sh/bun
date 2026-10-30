// a build reports what `bun check` reports in the project of each file: undefined for a number, in a folder with the option below one without it
// RUN: link
// DIAGNOSTIC: TS2322 1
// STATISTIC: SourceFilesDemoted = 0

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
