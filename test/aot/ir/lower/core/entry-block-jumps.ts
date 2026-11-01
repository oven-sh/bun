// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0(
// CHECK-NEXT: Jump -> next b1()
// CHECK-NOT: -> {{*}}b0(

export function f(n: number) {
  while (n) n--;
}
