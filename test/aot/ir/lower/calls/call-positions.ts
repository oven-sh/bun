// RUN: lower
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK: [[made]] = Call {{*}}calleeName="f" @437
// CHECK-NEXT: = Call [[made]], {{*}} @440
// CHECK-LABEL: function {{*}}name="index"
// CHECK: = Call {{*}} @493
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[result]] = Call {{*}}calleeName="a.b.c" @556

interface Holder {
  b: { c(x: number): number };
}

export function callResult(f: any, x: any, y: any) {
  f(x)(y);
}

export function index(a: any, x: any) {
  a[1](x);
}

export function member(a: Holder, x: number) {
  a.b.c(x);
}
