// RUN: lower
// CHECK-LABEL: function {{*}}name="eachResource"
// CHECK: [[iterator]] = IteratorOpen
// CHECK: LoopHint
// CHECK: builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call {{*}}, -, [[resource]]
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
