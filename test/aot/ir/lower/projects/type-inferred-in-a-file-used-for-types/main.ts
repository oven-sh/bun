// a type that is inferred from the body of a function in a file that is imported for its types alone
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import type { Made } from "./imports/types";
const made: Made = { width: 2, name: "a" };
console.log(made.width + 1, made.name);
