// RUN: lower
// CHECK-LABEL: function {{*}}name="eitherCall"
// CHECK-NOT: Return [[value]]
// CHECK: key="call"
// CHECK: [[first]] = Call
// CHECK-NEXT: ReturnCall [[first]]
// CHECK-NOT: Return [[value]]
// CHECK: key="call2"
// CHECK: [[second]] = Call
// CHECK-NEXT: ReturnCall [[second]]
// CHECK-NOT: Return [[value]]
// CHECK-NOT: ReturnCall

declare function call(): number;
declare function call2(n: number): unknown;
declare const flag: boolean;

export function eitherCall() {
  return flag ? call() : call2(1);
}
