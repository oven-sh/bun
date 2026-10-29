// RUN: lower
// CHECK-LABEL: function {{*}}name="ignored"
// CHECK: handler=[[handler]](
// CHECK: key="call"
// CHECK: [[handler]]() role=CatchHandler:
// CHECK-NEXT: = CatchValue
// CHECK: key="after"

declare function call(): number;
declare function after(): void;

export function ignored() {
  try {
    call();
  } catch {
    after();
  }
}
