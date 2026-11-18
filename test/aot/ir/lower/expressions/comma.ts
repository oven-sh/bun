// RUN: lower
// CHECK-LABEL: function {{*}}name="sequence"
// CHECK: b0([[f]]: anything, [[g]]: anything, [[h]]: anything):
// CHECK: = Call [[f]] calleeName="f"
// CHECK-NEXT: = Call [[g]] calleeName="g"
// CHECK-NEXT: [[last]] = Call [[h]] calleeName="h"
// CHECK-NEXT: Return [[last]]

export function sequence(f: any, g: any, h: any): any {
  var last = (f(), g(), h());
  return last;
}
