// RUN: lower
// CHECK-LABEL: function {{*}}name="folded"
// CHECK: Switch [[subject]] cases=[4, -1, 3, 5]
// CHECK: SwitchString [[subject]] strings=["ab"]

// RUN(EVALUATED): lower
// EVALUATED-LABEL: function {{*}}name="folded"
// EVALUATED-NOT: LShift
// EVALUATED-NOT: StrictEq

declare function use(value: unknown): void;

export function folded(x: unknown) {
  switch (x) {
    case 1 << 2:
      use(1);
      break;
    case -1:
      use(2);
      break;
    case +3:
      use(3);
      break;
    case "a" + "b":
      use(4);
      break;
    case (5 as number):
      use(5);
      break;
  }
}
