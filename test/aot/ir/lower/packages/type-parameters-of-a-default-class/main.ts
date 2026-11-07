// mismatched type parameters on an unnamed default class in a dependency stop no build and are not reported: the dependency keeps its types
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 2
// CHECK: layout [[box]] kind=Instance module=[[package]] constructor=[[constructor]]
// CHECK: function [[constructor]] name="default" module=[[package]] {{*}}flags=[HasNewTarget, IsChecked]

import Box from "ships-typescript";
console.log(new Box().size);
declare const console: { log(...values: unknown[]): void };
