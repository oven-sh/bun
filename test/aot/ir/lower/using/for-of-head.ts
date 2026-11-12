// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="eachResource"
// CHECK: [[iterator]] = IteratorOpen
// CHECK: LoopHint
// CHECK: TypeTest [[resource]] testedType=undefined|null
// CHECK: [[read]] = PropGet {{*}} key=@@dispose
// CHECK-NEXT: TypeTest [[read]] testedType=function
// CHECK: integer=1
// CHECK: role=DisposalCleanup subject=[[resource]] handler=[[closing]](
// CHECK: [[closing]]({{*}}) role=IterationCleanup subject=[[iterator]]:

declare function use(value: unknown): void;
declare const list: Disposable[];

export function eachResource() {
  for (using a of list) {
    use(1);
  }
}
