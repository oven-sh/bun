// RUN: lower
// CHECK-LABEL: function {{*}}name="arithmetic"
// CHECK: [[calledFirst]] = Call {{*}}calleeName="f"
// CHECK-NEXT: [[first]] = Convert [[calledFirst]] declared={type=number flags=[IsExpected]}
// CHECK: [[calledSecond]] = Call {{*}}calleeName="g"
// CHECK-NEXT: [[second]] = Convert [[calledSecond]] declared={type=number flags=[IsExpected]}
// CHECK: [[calledThird]] = Call {{*}}calleeName="h"
// CHECK-NEXT: [[third]] = Convert [[calledThird]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[product]] = Mul [[second]], [[third]]
// CHECK-NEXT: = Add [[first]], [[product]]
// CHECK-LABEL: function {{*}}name="comparison"
// CHECK: [[left]] = Call {{*}}calleeName="f"
// CHECK: [[right]] = Call {{*}}calleeName="g"
// CHECK-NEXT: = Less [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="membership"
// CHECK: [[key]] = Call {{*}}calleeName="f"
// CHECK: [[calledObject]] = Call {{*}}calleeName="g"
// CHECK-NEXT: [[object]] = Convert [[calledObject]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: = ElemHas [[object]], [[key]]

export function arithmetic(f: any, g: any, h: any) {
  return f() + g() * h();
}

export function comparison(f: any, g: any) {
  return f() < g();
}

export function membership(f: any, g: any) {
  return f() in g();
}
