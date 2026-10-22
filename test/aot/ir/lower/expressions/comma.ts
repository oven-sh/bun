// RUN: lower
// CHECK-LABEL: function {{*}}name="sequence"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-NEXT: [[g]] = Convert {{*}} declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[g]] calleeName="g"
// CHECK-NEXT: [[h]] = Convert {{*}} declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[last]] = Call [[h]] calleeName="h"
// CHECK-NEXT: Return [[last]]

export function sequence(f: any, g: any, h: any): any {
  const last = (f(), g(), h());
  return last;
}
