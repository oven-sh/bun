// RUN: lower
// CHECK-LABEL: function {{*}}name="jumps"
// CHECK-NOT: Switch
// CHECK: key="cleanup"
// CHECK-NOT: key="cleanup"
// CHECK: Switch {{*}}cases=[0, 1, 2, 3, 4] ->
// CHECK-NOT: key="cleanup"
// CHECK-NOT: Switch

// RUN(TARGETS): lower
// TARGETS-LABEL: function {{*}}name="jumps"
// TARGETS: Jump -> next
// TARGETS: Jump -> next [[outerHeader]]()
// TARGETS-NEXT: [[outerHeader]]():
// TARGETS-NEXT: LoopHint
// TARGETS-NEXT: Jump -> next
// TARGETS: Jump -> next [[innerHeader]]()
// TARGETS-NEXT: [[innerHeader]]():
// TARGETS-NEXT: LoopHint
// TARGETS: Switch {{*}} -> case [[fallThrough]](), case [[breakInner]](), case [[continueInner]](), case [[breakOuter]](), case [[continueOuter]](), otherwise [[rethrow]]()
// TARGETS: [[breakInner]]():
// TARGETS-NEXT: Jump -> next [[afterInner]]()
// TARGETS-NEXT: [[afterInner]]():
// TARGETS-NEXT: Jump -> next [[outerUpdate]]()
// TARGETS: [[continueInner]]():
// TARGETS-NEXT: Jump -> next [[innerUpdate]]()
// TARGETS-NEXT: [[innerUpdate]]():
// TARGETS-NEXT: Jump -> next [[innerHeader]]()
// TARGETS: [[breakOuter]]():
// TARGETS-NEXT: Jump -> next [[afterOuter]]()
// TARGETS-NEXT: [[afterOuter]]():
// TARGETS: Return
// TARGETS: [[continueOuter]]():
// TARGETS-NEXT: Jump -> next [[outerUpdate]]()
// TARGETS-NEXT: [[outerUpdate]]():
// TARGETS-NEXT: Jump -> next [[outerHeader]]()
// TARGETS: [[rethrow]]():
// TARGETS-NEXT: Throw

declare function call(): number;
declare function cleanup(): void;
declare const flag: boolean;

export function jumps() {
  outer: for (;;) {
    for (;;) {
      try {
        if (flag) break;
        if (flag) continue;
        if (flag) break outer;
        if (flag) continue outer;
        call();
      } finally {
        cleanup();
      }
    }
  }
}
