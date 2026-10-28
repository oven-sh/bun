// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[before]] = Convert {{*}}declared={type=number site=[[x]]} @
// CHECK: handler=[[handler]]([[before]]):
// CHECK-NEXT: = Call {{*}}calleeName="g"
// CHECK-NEXT: [[one]] = Integer integer=1
// CHECK-NEXT: [[after]] = Convert [[one]] declared={type=number site=[[x]]} @
// CHECK-NEXT: Jump -> next [[rest]]()
// CHECK-NEXT: [[rest]]() handler=[[handler]]([[after]]):
// CHECK-NEXT: = Call {{*}}calleeName="h"

declare function use(value: number): void;

export function f(g: () => void, h: () => void) {
  let x = 0;
  try {
    g();
    x = 1;
    h();
  } catch {
    use(x);
  }
}
