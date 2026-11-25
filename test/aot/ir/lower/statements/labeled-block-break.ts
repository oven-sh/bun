// RUN: lower
// CHECK-LABEL: function {{*}}name="leaveBlock"
// CHECK: Branch {{*}} -> taken [[after]]()
// CHECK: integer=1
// CHECK: Jump -> next [[after]]()
// CHECK-NEXT: [[after]]():
// CHECK: integer=2

declare function use(value: unknown): void;
declare const flag: boolean;

export function leaveBlock() {
  outer: {
    if (flag) break outer;
    use(1);
  }
  use(2);
}
