// a package that names the "aot" condition keeps its types, though its compilerOptions need another program than the entry point's
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 3
// CHECK: entry

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
