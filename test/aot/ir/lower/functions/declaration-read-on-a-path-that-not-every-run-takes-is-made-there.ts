// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK-NOT: NewClosure
// CHECK: Branch
// CHECK: = TypeTest {{*}}testedType=undefined|null
// CHECK: = NewClosure {{*}}function=[[helper]]
// CHECK: = Call {{*}}calleeKey="push"
// CHECK-NOT: NewClosure
// CHECK: = CallDirect {{*}}function=[[helper]]
// CHECK: function [[helper]] name="helper"

export function outer(flag: boolean, kept: unknown[], step: number): number {
  if (flag) kept.push(helper);
  return helper(1) + helper(2);
  function helper(n: number): number {
    return n + step;
  }
}
