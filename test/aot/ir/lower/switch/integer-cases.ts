// RUN: lower
// CHECK-LABEL: function {{*}}name="integers"
// CHECK: Switch [[subject]] cases=[1, 2] -> case [[one]](| 0), case [[two]](| 0), otherwise [[none]]()
// CHECK: [[one]]([[isOne]]):
// CHECK: integer=1
// CHECK: [[two]]([[isTwo]]):
// CHECK: integer=2
// CHECK: [[none]]():
// CHECK: integer=3

// RUN(TESTS): lower
// TESTS-LABEL: function {{*}}name="integers"
// TESTS-NOT: StrictEq
// TESTS: Switch
// TESTS-NOT: StrictEq
// TESTS-NOT: Switch

declare function use(value: unknown): void;

export function integers(x: unknown) {
  switch (x) {
    case 1:
      use(1);
      break;
    case 2:
      use(2);
      break;
    default:
      use(3);
      break;
  }
}
