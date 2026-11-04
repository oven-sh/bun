// RUN: lower
// CHECK-LABEL: function {{*}}name="clauses"
// CHECK: [[absent]] = Absent
// CHECK: Switch {{*}}cases=[1, 2]
// CHECK: Jump -> next [[second]]([[absent]])
// CHECK: [[second]]([[y]]):
// CHECK: CheckInitialized [[y]] name="y"

declare function use(value: unknown): void;
declare function call2(n: number): unknown;

export function clauses(x: unknown) {
  switch (x) {
    case 1:
      let y = call2(1);
      use(y);
    case 2:
      use(y);
  }
}
