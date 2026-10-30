// a package that ships its TypeScript is not held to the application's rules that only report
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { first } from "ships-typescript";
console.log(first([3, 4]));
