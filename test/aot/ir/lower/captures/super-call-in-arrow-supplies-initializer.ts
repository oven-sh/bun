// RUN: lower
// CHECK-LABEL: function {{*}}kind=DerivedConstructor
// CHECK: captures=[{type=anything variableName="a"}] thisType
// CHECK-LABEL: function {{*}}name="s"
// CHECK: captures=[{type=env {{*}}}, {type=anything variableName="a"}, {type=anything}, {type=function flags=[IsFromCompiler]}] thisType
// CHECK: b0([[environment]]: env {{*}}, [[a]]: anything, [[newTarget]]: anything, [[callee]]: function):
// CHECK: [[this]] = SuperConstruct {{*}}layout=[[instance]]
// CHECK-NEXT: [[receiver]] = Convert [[this]] declared={type=[[instance]]}
// CHECK: = CallDirect [[a]], [[receiver]] function=[[initializer]]
// CHECK: function [[initializer]] {{*}}kind=Initializer{{*}}captures=[{type=anything variableName="a"}] thisType={type=[[instance]]}

declare function g(): string;

class B {}

export function f() {
  const a = g();
  return class extends B {
    x = a;
    // @ts-ignore
    constructor() {
      // @ts-ignore
      const s = () => super();
      s();
    }
  };
}
