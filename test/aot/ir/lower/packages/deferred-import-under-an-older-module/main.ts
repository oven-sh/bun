// a package that ships its TypeScript stays typed where it defers an import and the application's module is an older one
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { later } from "ships-typescript";
console.log(later(1));
