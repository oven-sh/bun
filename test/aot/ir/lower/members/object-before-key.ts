// RUN: lower
// CHECK-LABEL: function {{*}}name="read"
// CHECK-NOT: = Call
// CHECK: [[calledObject]] = Call {{*}}calleeName="f"
// CHECK-NEXT: [[object]] = Convert [[calledObject]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NOT: = Call
// CHECK: [[key]] = Call {{*}}calleeName="g"
// CHECK-NEXT: = ElemGet [[object]], [[key]]
// CHECK-LABEL: function {{*}}name="store"
// CHECK-NOT: = Call
// CHECK: [[calledTarget]] = Call {{*}}calleeName="f"
// CHECK-NEXT: [[target]] = Convert [[calledTarget]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NOT: = Call
// CHECK: [[name]] = Call {{*}}calleeName="g"
// CHECK-NOT: = Call
// CHECK: [[value]] = Call {{*}}calleeName="h"
// CHECK-NEXT: ElemSet [[target]], [[name]], [[value]]

// RUN(CONVERSIONS): lower
// CONVERSIONS-NOT: ToPropertyKey

export function read(f: any, g: any) {
  return f()[g()];
}

export function store(f: any, g: any, h: any) {
  f()[g()] = h();
}
