// RUN: lower
// CHECK-LABEL: function {{*}}name="middle"
// CHECK: Switch [[subject]] cases=[1, 2] -> case {{*}}, case {{*}}, otherwise [[none]]()
// CHECK-NOT: Switch
// CHECK: [[none]]():
// CHECK-NEXT: Jump -> next [[default]]()
// CHECK: [[default]]():
// CHECK: integer=2
// CHECK: Jump -> next [[last]]()
// CHECK: [[last]]():
// CHECK: integer=3
// CHECK-NOT: Switch

declare function use(value: unknown): void;

export function middle(x: unknown) {
  switch (x) {
    case 1:
      use(1);
    default:
      use(2);
    case 2:
      use(3);
  }
}
