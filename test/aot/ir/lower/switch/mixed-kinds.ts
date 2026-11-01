// RUN: lower
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK-NOT: = StrictEq
// CHECK: Switch [[subject]] cases=[1, 2]
// CHECK-NOT: = StrictEq
// CHECK: SwitchString [[subject]] strings=["a"]
// CHECK: = Null
// CHECK-NEXT: = StrictEq
// CHECK: = Double number=1.5
// CHECK-NEXT: = StrictEq
// CHECK: = Boolean boolean=true
// CHECK-NEXT: = StrictEq
// CHECK: = BigInt digits="10"
// CHECK-NEXT: = StrictEq
// CHECK-NOT: = StrictEq

// RUN(SWITCHES): lower
// SWITCHES-LABEL: function {{*}}name="mixed"
// SWITCHES-COUNT-2: Switch
// SWITCHES-NOT: Switch

declare function use(value: unknown): void;

export function mixed(x: unknown) {
  switch (x) {
    case 1:
      use(1);
      break;
    case "a":
      use(2);
      break;
    case 2:
      use(3);
      break;
    case null:
      use(4);
      break;
    case 1.5:
      use(5);
      break;
    case true:
      use(6);
      break;
    case 10n:
      use(7);
      break;
  }
}
