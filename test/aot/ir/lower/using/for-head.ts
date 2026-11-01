// RUN: lower
// CHECK-LABEL: function {{*}}name="loopHead"
// CHECK: [[helper]] = Builtin builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call [[helper]], -, [[resource]]
// CHECK-NEXT: Jump -> next [[covered]]()
// CHECK-NEXT: [[covered]]() handler=[[landing]]():
// CHECK-NEXT: Jump -> next [[header]]()
// CHECK-NEXT: [[header]]() handler=[[landing]]():
// CHECK-NEXT: LoopHint
// CHECK: integer=1
// CHECK: [[landing]]() role=DisposalCleanup subject=[[resource]]:

// RUN(REGIONS): lower
// REGIONS-COUNT-1: role=DisposalCleanup
// REGIONS-NOT: role=DisposalCleanup

declare function use(value: unknown): void;
declare function resource(): Disposable;
declare const flag: boolean;

export function loopHead() {
  for (using a = resource(); flag; ) {
    use(1);
  }
}
