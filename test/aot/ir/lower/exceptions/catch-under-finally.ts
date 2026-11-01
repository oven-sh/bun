// RUN: lower
// CHECK-LABEL: function {{*}}name="both"
// CHECK: handler=[[landing]](
// CHECK: handler=[[catch]](
// CHECK: key="call"
// CHECK: [[catch]]() role=CatchHandler handler=[[landing]]():
// CHECK: key="use"
// CHECK: [[landing]]() role=CleanupHandler:
// CHECK: key="cleanup"

declare function use(value: unknown): void;
declare function call(): number;
declare function cleanup(): void;

export function both() {
  try {
    call();
  } catch (e) {
    use(e);
  } finally {
    cleanup();
  }
}
