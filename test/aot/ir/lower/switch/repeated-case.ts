// RUN: lower
// CHECK-LABEL: function {{*}}name="repeated"
// CHECK: Switch [[subject]] cases=[1, 0]
// CHECK: integer=1
// CHECK: integer=3
// CHECK: SwitchString [[subject]] strings=["a"]
// CHECK: integer=5

// RUN(SHADOWED): lower
// SHADOWED-LABEL: function {{*}}name="repeated"
// SHADOWED-NOT: integer=2
// SHADOWED-NOT: integer=4
// SHADOWED-NOT: integer=6

declare function use(value: unknown): void;

export function repeated(x: unknown) {
  switch (x) {
    case 1:
      use(1);
      break;
    case 1:
      use(2);
      break;
    case -0:
      use(3);
      break;
    case 0:
      use(4);
      break;
    case "a":
      use(5);
      break;
    case "a":
      use(6);
      break;
  }
}
