// RUN: lower
// CHECK-LABEL: function {{*}}name="shared"
// CHECK: handler=[[landing]](
// CHECK: Jump -> next [[returnExit]]([[value]])
// CHECK-NEXT: [[returnExit]]([[carried]]):
// CHECK-NEXT: [[returnPath]] = Integer integer=1
// CHECK: Jump -> next [[finalizer]]([[returnPath]], [[carried]], {{*}})
// CHECK: [[landing]]() role=CleanupHandler:
// CHECK-NEXT: [[caught]] = CatchValue
// CHECK-NEXT: [[throwPath]] = Integer integer=2
// CHECK: Jump -> next [[finalizer]]([[throwPath]], {{*}}, [[caught]])
// CHECK: [[finalizer]]([[selector]], [[returned]], [[thrown]]):
// CHECK: key="cleanup"
// CHECK: Switch [[selector]] cases=[0, 1] -> case [[onFallThrough]](), case [[onReturn]](), otherwise [[onThrow]]()
// CHECK: [[onFallThrough]]():
// CHECK: integer=2
// CHECK: [[onReturn]]():
// CHECK-NEXT: [[result]] = Convert [[returned]] declared={type=int[1, 2] site=w{{*}}}
// CHECK-NEXT: Return [[result]]
// CHECK: [[onThrow]]():
// CHECK-NEXT: Throw [[thrown]]

// RUN(COPIES): lower
// COPIES-COUNT-1: key="cleanup"
// COPIES-NOT: key="cleanup"

// RUN(VALUE): lower
// VALUE-NOT: CatchException

declare function call(): number;
declare function cleanup(): void;
declare const flag: boolean;

export function shared() {
  try {
    if (flag) return 1;
    call();
  } finally {
    cleanup();
  }
  return 2;
}
