// the file under the aot condition of a package whose declarations are in @types
// RUN: link
// DIAGNOSTIC: TS100009 1
// STATISTIC: SourceFilesDemoted = 1

import { area } from "shapes";
console.log(area(2));
