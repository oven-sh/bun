// the file under the aot condition of a package whose declarations are in @types is compiled with the types that it writes itself
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 2
// CHECK: module [[shapes]] path="{{*}}node_modules/shapes/index.aot.ts"
// CHECK: function {{*}}name="area" module=[[shapes]] {{*}}flags=[IsChecked, HasExplicitName]{{*}}results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}]

import { area } from "shapes";
console.log(area(2));
