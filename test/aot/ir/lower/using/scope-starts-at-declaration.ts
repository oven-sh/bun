// RUN: lower
// CHECK-LABEL: function {{*}}name="starts"
// CHECK-NOT: handler=
// CHECK: integer=1
// CHECK-NOT: handler=
// CHECK: [[helper]] = Builtin builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call [[helper]], -, [[resource]]
// CHECK-NEXT: Jump -> next [[covered]]()
// CHECK-NEXT: [[covered]]() handler=[[landing]]():
// CHECK: integer=2
// CHECK: [[landing]]() role=DisposalCleanup subject=[[resource]]:

declare function use(value: unknown): void;
declare function resource(): Disposable;

export function starts() {
  use(1);
  using a = resource();
  use(2);
}
