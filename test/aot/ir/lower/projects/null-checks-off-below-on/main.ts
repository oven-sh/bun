// a file whose project needs another program than the entry point's is held to nothing that it declares: undefined for a number, in a file without the option below an entry point that has it
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: function {{*}}name="first" {{*}}parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}] results=[{type=anything}]

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
