// RUN: lower
// CHECK-LABEL: function {{*}}name="large"
// CHECK-NOT: = StrictEq
// CHECK: Switch [[subject]] cases=[1]
// CHECK: [[number]] = Double
// CHECK-NEXT: = StrictEq [[subject]], [[number]]
// CHECK-NOT: = StrictEq
// CHECK-NOT: Switch

declare function use(value: unknown): void;

export function large(x: unknown) {
  switch (x) {
    case 4611686018427387904:
      use(1);
      break;
    case 1:
      use(2);
      break;
  }
}
