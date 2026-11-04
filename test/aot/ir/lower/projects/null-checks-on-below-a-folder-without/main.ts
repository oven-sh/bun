// a file whose project makes the program of the entry point is held to what it declares: undefined for a number, in a folder with the option below one without it
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: function {{*}}name="first" {{*}}results=[{type=anything}]
// CHECK: function {{*}}name="none" {{*}}flags=[IsChecked, HasExplicitName] {{*}}results=[{type=number}]
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: = Convert [[nothing]] declared={type=number}

import { first } from "./imports/inner/lib.ts";
console.log(first([]), first([4]));
