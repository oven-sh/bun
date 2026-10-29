// a file under the aot condition with a type error is compiled without its types
// RUN: link
// DIAGNOSTIC: TS100009 1
// STATISTIC: SourceFilesDemoted = 1

import { area } from "shapes";
console.log(area(2));
