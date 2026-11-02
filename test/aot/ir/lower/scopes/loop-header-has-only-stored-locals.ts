// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: Jump -> next [[header]]([[initial]])
// CHECK-NEXT: [[header]]([[a]]: number):
// CHECK-NEXT: LoopHint
// CHECK: [[sum]] = Add [[a]],
// CHECK-NEXT: [[next]] = Convert [[sum]] declared={type=number site=w{{*}}} @
// CHECK-NEXT: Jump -> next [[header]]([[next]])

declare function c(): boolean;

export function f() {
  let a = 0,
    b = 1;
  while (c()) a += b;
  return a;
}
