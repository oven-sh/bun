// RUN: lower
// CHECK-LABEL: function {{*}}name="declares"
// CHECK-NOT: handler=
// CHECK: key="resource"
// CHECK: = Call
// CHECK-NOT: handler=
// CHECK: [[helper]] = Builtin builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: [[method]] = Call [[helper]], -, [[resource]]
// CHECK: handler=[[landing]](
// CHECK: integer=1
// CHECK: [[landing]]({{*}}) role=DisposalCleanup subject=[[resource]]

// RUN(KEYS): lower
// KEYS-NOT: @@dispose

declare function use(value: unknown): void;
declare function resource(): Disposable;

export function declares() {
  using a = resource();
  use(1);
}
