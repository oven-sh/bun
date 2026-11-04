// RUN: lower
// CHECK-LABEL: function {{*}}name="leaves"
// CHECK: key="call"
// CHECK: Jump -> next [[exit]]()
// CHECK: [[exit]]() handler=[[outermost]]():
// CHECK: [[finalizer]]([[selector]], [[thrown]]) handler=[[outermost]]():
// CHECK: key="cleanup"
// CHECK: [[outermost]]() role=CatchHandler:
// CHECK-NEXT: = CatchValue
// CHECK: key="after"

declare function use(value: unknown): void;
declare function call(): number;
declare function cleanup(): void;
declare function after(): void;

export function leaves() {
  try {
    done: try {
      try {
        call();
        break done;
      } catch {
        use(1);
      }
    } finally {
      cleanup();
    }
  } catch {
    after();
  }
}
