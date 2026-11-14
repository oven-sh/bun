// RUN: lower
// CHECK-LABEL: function {{*}}name="split"
// CHECK-NOT: = StrictEq
// CHECK: Switch {{*}}cases=[1, 2]
// CHECK-NOT: = StrictEq
// CHECK: key="call"
// CHECK: = StrictEq
// CHECK-NOT: = StrictEq
// CHECK: Switch {{*}}cases=[3, 4]
// CHECK-NOT: = StrictEq

declare function use(value: unknown): void;
declare function call(): number;

export function split(x: unknown) {
  switch (x) {
    case 1:
      use(1);
      break;
    case 2:
      use(2);
      break;
    case call():
      use(3);
      break;
    case 3:
      use(4);
      break;
    case 4:
      use(5);
      break;
  }
}
