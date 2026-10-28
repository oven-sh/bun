// RUN: lower
// CHECK-LABEL: function {{*}}name="alwaysFalse"
// CHECK-NOT: Branch
// CHECK-NOT: integer=1
// CHECK: integer=2
// CHECK-NOT: Branch
// CHECK-NOT: integer=1
// CHECK-LABEL: function {{*}}name="alwaysTrue"
// CHECK-NOT: Branch
// CHECK-NOT: integer=2
// CHECK: integer=1
// CHECK-NOT: Branch
// CHECK-NOT: integer=2
// CHECK-LABEL: function {{*}}name="unknownTest"
// CHECK: Branch
// CHECK-NOT: Branch
// CHECK: integer=1
// CHECK-NOT: Branch
// CHECK: integer=2
// CHECK-NOT: Branch

declare function use(value: unknown): void;
declare const flag: boolean;

export function alwaysFalse() {
  if (false) use(1);
  else use(2);
}

export function alwaysTrue() {
  if (true) use(1);
  else use(2);
}

export function unknownTest() {
  if (flag) use(1);
  else use(2);
}
