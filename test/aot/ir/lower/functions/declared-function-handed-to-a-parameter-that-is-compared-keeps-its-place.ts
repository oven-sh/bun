// RUN: lower
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: = GetEnvironmentField
// CHECK: testedType=undefined|null
// CHECK: = NewClosure
// CHECK: PutEnvironmentField

export function outer(): boolean[] {
  let last: unknown;
  function same(action: () => void) {
    const was = last;
    last = action;
    return was === action;
  }
  function visit() {}
  function ask() {
    return same(visit);
  }
  return [ask(), ask()];
}
