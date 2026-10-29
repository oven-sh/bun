// RUN: lower
// CHECK-LABEL: function {{*}}name="nothing"
// CHECK: [[resource]] = Null
// CHECK: [[method]] = Call [[helper]], -, [[resource]]
// CHECK: TypeTest [[method]] testedType=undefined
// CHECK: = Call [[onFallThrough]], [[resource]]
// CHECK: role=DisposalCleanup subject=[[resource]]
// CHECK: TypeTest [[method]] testedType=undefined
// CHECK: = Call [[onThrow]], [[resource]]

declare function use(value: unknown): void;

export function nothing() {
  using a = null;
  use(1);
}
