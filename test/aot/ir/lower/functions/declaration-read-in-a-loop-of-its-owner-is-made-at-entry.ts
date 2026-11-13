// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK: = NewClosure {{*}}function=[[helper]]
// CHECK: LoopHint
// CHECK-NOT: NewClosure
// CHECK: = Call {{*}}calleeKey="push"
// CHECK: function [[helper]] name="helper"

export function outer(flags: boolean[], kept: unknown[], step: number): number {
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) kept.push(helper);
  }
  return helper(1);
  function helper(n: number): number {
    return n + step;
  }
}
