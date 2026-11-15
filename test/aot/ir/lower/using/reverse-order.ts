// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: TypeTest [[first]] testedType=undefined|null
// CHECK: [[readFirst]] = PropGet {{*}} key=@@dispose
// CHECK-NEXT: TypeTest [[readFirst]] testedType=function
// CHECK: TypeTest [[second]] testedType=undefined|null
// CHECK: [[readSecond]] = PropGet {{*}} key=@@dispose
// CHECK-NEXT: TypeTest [[readSecond]] testedType=function
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
