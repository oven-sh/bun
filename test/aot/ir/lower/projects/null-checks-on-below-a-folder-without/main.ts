// a file whose project makes the program of the entry point is held to what it declares: undefined for a number, in a folder with the option below one without it
// RUN: link
// DIAGNOSTIC: TS2322 1
// STATISTIC: SourceFilesDemoted = 1

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
