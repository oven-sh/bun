// RUN: lower
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call {{*}}, -, [[first]]
// CHECK: builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call {{*}}, -, [[second]]
// CHECK: integer=1
// CHECK: Branch {{*}}notTaken [[secondPresent]](| 0)
// CHECK: [[secondPresent]]([[disposeSecond]]) handler=[[outer]]():
// CHECK-NEXT: = Call [[disposeSecond]], [[second]]
// CHECK: Branch {{*}}notTaken [[firstPresent]](| 0)
// CHECK: [[firstPresent]]([[disposeFirst]]):
// CHECK-NEXT: = Call [[disposeFirst]], [[first]]
// CHECK: Return
// CHECK: role=DisposalCleanup subject=[[second]] handler=[[outer]]():
// CHECK: [[outer]]() role=DisposalCleanup subject=[[first]]:

declare function use(value: unknown): void;
declare function resource(): Disposable;

export function nested() {
  using a = resource();
  using b = resource();
  use(1);
}
