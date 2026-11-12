// a type error beside a decorated class of a dependency stops no build and is not reported: the method is decorated, and the dependency keeps its types
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 2
// CHECK: [[decorate]] = Builtin builtin=CompilerHelpersDecorateMethod
// CHECK-NEXT: = Call [[decorate]],
// CHECK-LABEL: function {{*}}name="two"{{*}}flags=[IsChecked, HasExplicitName]
// CHECK: [[wrong]] = Integer integer=2
// CHECK-NEXT: = Convert [[wrong]] declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}

import { Marked } from "decorates";
console.log(new Marked().two(), JSON.stringify((Marked.prototype as any).marked));
