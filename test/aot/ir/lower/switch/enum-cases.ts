// RUN: lower
// CHECK-LABEL: function {{*}}name="members"
// CHECK: Switch [[subject]] cases=[0, 1]
// CHECK: SwitchString [[subject]] strings=["b"]

// RUN(EVALUATED): lower
// EVALUATED-LABEL: function {{*}}name="members"
// EVALUATED-NOT: key="Red"
// EVALUATED-NOT: StrictEq

declare function use(value: unknown): void;

enum Color {
  Red,
  Green,
  Blue = "b",
}

export function members(c: Color) {
  switch (c) {
    case Color.Red:
      use(1);
      break;
    case Color.Green:
      use(2);
      break;
    case Color.Blue:
      use(3);
      break;
  }
}
