// RUN: lower
// CHECK-LABEL: function {{*}}name="twoReturns"
// CHECK: integer=1
// CHECK: Jump -> next [[exit]]([[first]])
// CHECK: integer=2
// CHECK: Jump -> next [[exit]]([[second]])
// CHECK: [[exit]]([[returned]]):
// CHECK: Switch {{*}}cases=[0] ->

declare function cleanup(): void;
declare const flag: boolean;

export function twoReturns() {
  try {
    if (flag) return 1;
    return 2;
  } finally {
    cleanup();
  }
}
