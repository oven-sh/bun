// RUN: lower
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call {{*}}, -, [[first]]
// CHECK: builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call {{*}}, -, [[second]]
// CHECK: integer=1
// CHECK: Branch {{*}}notTaken [[secondPresent]](| 0)
// CHECK: [[secondPresent]]([[disposeSecond]]) handler=[[outer]]():
// CHECK: handler=[[secondThrew]]():
// CHECK-NEXT: = Call [[disposeSecond]], [[second]]
// CHECK: Branch {{*}}notTaken [[firstPresent]](| 0)
// CHECK: [[firstPresent]]([[disposeFirst]]):
// CHECK: handler=[[firstThrew]]():
// CHECK-NEXT: = Call [[disposeFirst]], [[first]]
// CHECK: Return
// CHECK: [[firstThrew]]() role=CatchHandler:
// CHECK-NEXT: [[fromFirst]] = CatchValue
// CHECK-NEXT: Throw [[fromFirst]]
// CHECK: [[secondThrew]]() role=CatchHandler handler=[[outer]]():
// CHECK-NEXT: [[fromSecond]] = CatchValue
// CHECK-NEXT: Throw [[fromSecond]]
// CHECK: role=DisposalCleanup subject=[[second]] handler=[[outer]]():
// CHECK: [[outer]]() role=DisposalCleanup subject=[[first]]:

declare function use(value: unknown): void;
declare function resource(): Disposable;

export function nested() {
  using a = resource();
  using b = resource();
  use(1);
}
