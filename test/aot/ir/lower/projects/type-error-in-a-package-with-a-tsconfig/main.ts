// a type error in a package with a tsconfig.json of its own is a warning, beside a folder of the program without the option
// RUN: link
// DIAGNOSTIC: TS100009 1
// STATISTIC: SourceFilesDemoted = 1

import { first } from "inner";
import { last } from "./imports/mine/lib.ts";
console.log(first([]), first([4]), last([]), last([5]));
