// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[a]] = Call {{*}}calleeName="g"
// CHECK: = NewClosure [[a]] function=
// CHECK-LABEL: function {{*}}kind=BaseConstructor
// CHECK: captures=[{type=anything variableName="a"}] thisType
// CHECK: b0([[copy]]: anything,
// CHECK: = CallDirect [[copy]], [[this]] function=
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: captures=[{type=anything variableName="a"}] thisType

declare function g(): unknown;

export function f() {
  const a = g();
  return class {
    x = a;
  };
}
