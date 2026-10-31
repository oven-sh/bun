// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: handler=[[handler]](
// CHECK: = Call {{*}}calleeName="g"
// CHECK: [[handler]]({{*}} role=CatchHandler
// CHECK-NEXT: = CatchValue

export function f(g: () => void, h: () => void, k: (error: unknown) => void) {
  try {
    g();
    h();
  } catch (e) {
    k(e);
  }
}
