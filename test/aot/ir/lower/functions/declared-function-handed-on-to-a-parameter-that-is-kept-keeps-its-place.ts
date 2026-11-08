// RUN: lower
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: = GetEnvironmentField
// CHECK: testedType=undefined|null
// CHECK: = NewClosure

export function outer(kept: unknown[]): number {
  function first(action: () => void) {
    return second(action);
  }
  function second(action: () => void) {
    return kept.push(action);
  }
  function visit() {}
  function ask() {
    return first(visit);
  }
  return ask() + ask();
}
