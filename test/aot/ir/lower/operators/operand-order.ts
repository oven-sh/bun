// RUN: lower
// CHECK-LABEL: function {{*}}name="arithmetic"
// CHECK: [[first]] = Call {{*}}calleeName="f"
// CHECK: [[second]] = Call {{*}}calleeName="g"
// CHECK: [[third]] = Call {{*}}calleeName="h"
// CHECK-NEXT: [[product]] = Mul [[second]], [[third]]
// CHECK-NEXT: = Add [[first]], [[product]]
// CHECK-LABEL: function {{*}}name="comparison"
// CHECK: [[left]] = Call {{*}}calleeName="f"
// CHECK: [[right]] = Call {{*}}calleeName="g"
// CHECK-NEXT: = Less [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="membership"
// CHECK: [[key]] = Call {{*}}calleeName="f"
// CHECK: [[object]] = Call {{*}}calleeName="g"
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
