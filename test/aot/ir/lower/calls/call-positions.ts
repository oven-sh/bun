// RUN: lower
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK: [[made]] = Call {{*}}calleeName="f" @600
// CHECK-NEXT: [[convertedMade]] = Convert [[made]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[convertedMade]], {{*}} @603
// CHECK-LABEL: function {{*}}name="index"
// CHECK: = Call {{*}} @656
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[result]] = Call {{*}}calleeName="c" @719
// CHECK-NEXT: = Convert [[result]] {{*}} @715

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
