// a build reports what `bun check` reports in the project of each file: a member of what may be undefined, in a file with the option below an entry point that lacks it
// RUN: link
// DIAGNOSTIC: TS18048 1
// STATISTIC: SourceFilesDemoted = 0

import { size } from "./imports/inner/lib.ts";
console.log(size("a"));
