// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|number site=[[site]]}]
// CHECK-NOT: Convert
// CHECK: [[default]] = Call
// CHECK-NEXT: = Convert [[default]] declared={type=number site=[[site]]} illTypedCause=FromLooseType
// CHECK-NOT: Convert

// The parameter takes `undefined` for an argument that is left out. The default initializes the binding, which does not.
declare function g(): any;

export function f(a: number = g()) {}
