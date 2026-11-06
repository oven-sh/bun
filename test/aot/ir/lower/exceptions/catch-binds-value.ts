// RUN: lower
// CHECK-LABEL: function {{*}}name="caught"
// CHECK-NOT: handler=
// CHECK: [[covered]]() handler=[[handler]]():
// CHECK: key="call"
// CHECK: [[handler]]() role=CatchHandler:
// CHECK-NEXT: [[error]] = CatchValue
// CHECK: = Call {{*}}, -, [[error]]
// CHECK: Jump -> next [[join]]()
// CHECK: [[join]]():
// CHECK: key="after"

declare function use(value: unknown): void;
declare function call(): number;
declare function after(): void;

export function caught() {
  try {
    call();
  } catch (e) {
    use(e);
  }
  after();
}
