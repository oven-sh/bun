// RUN: lower
// CHECK-LABEL: function {{*}}name="calls"
// CHECK: [[first]] = Call {{*}}calleeName="f"
// CHECK-NOT: = Call
// CHECK: = ToString [[first]]
// CHECK: [[second]] = Call {{*}}calleeName="g"
// CHECK: = ToString [[second]]
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK-NEXT: ([[x]]: {{*}}, [[y]]:
// CHECK: [[a]] = String string="a"
// CHECK: [[xText]] = ToString [[x]]
// CHECK: [[b]] = String string="b"
// CHECK: [[yText]] = ToString [[y]]
// CHECK: = Strcat [[a]], [[xText]], [[b]], [[yText]] @
// CHECK-LABEL: function {{*}}name="pair"
// CHECK-NOT: = String
// CHECK: = Strcat [[left]], [[right]] @
// CHECK-NOT: = String
// CHECK-LABEL: function {{*}}name="single"
// CHECK: [[text]] = ToString
// CHECK-NOT: Strcat
// CHECK: Return [[text]]

export function calls(f: any, g: any): any {
  return `${f()}${g()}`;
}

export function mixed(x: any, y: any): any {
  return `a${x}b${y}`;
}

export function pair(x: any, y: any): any {
  return `${x}${y}`;
}

export function single(x: any): any {
  return `${x}`;
}
