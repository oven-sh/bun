// RUN: lower
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: [[object]] = Call {{*}}calleeName="o"
// CHECK: [[key]] = Call {{*}}calleeName="k"
// CHECK: [[value]] = Call {{*}}calleeName="v"
// CHECK-NEXT: ElemSet [[object]], [[key]], [[value]]
// CHECK-LABEL: function {{*}}name="local"
// CHECK: [[assigned]] = Call {{*}}calleeName="v"
// CHECK-NEXT: Return [[assigned]]
// CHECK-LABEL: function {{*}}name="named"
// CHECK: [[target]] = Call {{*}}calleeName="o"
// CHECK: [[stored]] = Call {{*}}calleeName="v"
// CHECK-NEXT: PropSet [[target]], [[stored]] key="p"

// RUN(NOWHERE): lower
// NOWHERE-NOT: ToPropertyKey

export function computed(o: any, k: any, v: any) {
  o()[k()] = v();
}

export function local(x: any, v: any): any {
  x = v();
  return x;
}

export function named(o: any, v: any) {
  o().p = v();
}
