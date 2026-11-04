// RUN: lower
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK: [[made]] = Call {{*}}calleeName="f" @604
// CHECK-NEXT: [[convertedMade]] = Convert [[made]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[convertedMade]], {{*}} @607
// CHECK-LABEL: function {{*}}name="index"
// CHECK: = Call {{*}} @660
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[result]] = Call {{*}}calleeName="a.b.c" @723
// CHECK-NEXT: = Convert [[result]] {{*}} @719

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
