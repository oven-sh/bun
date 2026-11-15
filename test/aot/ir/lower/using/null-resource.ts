// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="maybe"
// CHECK: TypeTest [[resource]] testedType=undefined|null
// CHECK: [[read]] = PropGet {{*}} key=@@dispose
// CHECK-NEXT: TypeTest [[read]] testedType=function
// CHECK: Jump -> next [[found]]({{*}})
// CHECK-NEXT: [[found]]([[method]]):
// CHECK: TypeTest [[method]] testedType=undefined
// CHECK: = Call [[onFallThrough]], [[resource]]
// CHECK: role=DisposalCleanup subject=[[resource]]
// CHECK: TypeTest [[method]] testedType=undefined
// CHECK: = Call [[onThrow]], [[resource]]
// `using x = null` disposes of nothing, so it has no helper and no cleanup.
// CHECK-LABEL: function {{*}}name="nothing"
// CHECK-NOT: DisposalCleanup
// CHECK: Return

declare function use(value: unknown): void;

export function maybe(resource: Disposable | null) {
  using a = resource;
  use(1);
}

export function nothing() {
  using a = null;
  use(1);
}
