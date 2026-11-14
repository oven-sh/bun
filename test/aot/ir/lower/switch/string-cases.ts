// RUN: lower
// CHECK-LABEL: function {{*}}name="strings"
// CHECK-NOT: StrictEq
// CHECK: SwitchString [[subject]] strings=["a", "b"] -> case [[a]](| 0), case [[b]](| 0), otherwise [[none]]()
// CHECK-NOT: StrictEq
// CHECK-NOT: Switch

declare function use(value: unknown): void;

export function strings(x: unknown) {
  switch (x) {
    case "a":
      use(1);
      break;
    case "b":
      use(2);
      break;
  }
}
