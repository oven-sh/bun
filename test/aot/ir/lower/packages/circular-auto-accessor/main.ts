// a circular auto-accessor in a dependency stops no build and is not reported: the accessor is untyped, and the dependency keeps its types
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 2
// CHECK: function {{*}}name="value" {{*}}kind=Getter flags=[HasThis, IsChecked] {{*}}results=[{type=anything}]
// CHECK: function {{*}}name="value" {{*}}kind=Setter flags=[HasThis, IsChecked] {{*}}parameters=[{type=anything}]

import { Held } from "ships-typescript";
console.log(new Held().size);
declare const console: { log(...values: unknown[]): void };
