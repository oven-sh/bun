// a type error in a file under the aot condition is not reported, and the file keeps its types: what is written is tested where the value arrives
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="area"{{*}}flags=[IsChecked, HasExplicitName]
// CHECK: [[product]] = Mul
// CHECK-NEXT: = Convert [[product]] declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}

import { area } from "shapes";
console.log(area(2));
