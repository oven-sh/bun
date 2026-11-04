// the application's own read of a member of globalThis that its lib does not declare is a read like any other: it is not reported and stops no build
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: [[global]] = Convert {{*}}declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: [[document]] = PropGet [[global]] key="document"
// CHECK-NEXT: = TypeTest [[document]] testedType=undefined

console.log(globalThis.document === undefined);
