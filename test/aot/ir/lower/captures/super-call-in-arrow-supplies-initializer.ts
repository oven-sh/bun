// RUN: lower
// CHECK-LABEL: function {{*}}kind=DerivedConstructor
// CHECK: captures=[{type=undefined|null|string site=[[siteOfA]] flags=[OmitsNull, OmitsUndefined] variableName="a"}] thisType
// CHECK-LABEL: function {{*}}name="s"
// CHECK: captures=[{type=env {{*}}}, {type=undefined|null|string site=[[siteOfA]] flags=[OmitsNull, OmitsUndefined] variableName="a"}, {type=anything}, {type=function flags=[IsFromCompiler]}] thisType
// CHECK: b0([[environment]]: env {{*}}, [[a]]: undefined|null|string, [[newTarget]]: anything, [[callee]]: function):
// CHECK: [[this]] = SuperConstruct {{*}}layout=[[instance]]
// CHECK-NEXT: [[receiver]] = Convert [[this]] declared={type=[[instance]] flags=[IsFromCompiler]}
// CHECK: = CallDirect [[a]], [[receiver]] function=[[initializer]]
// CHECK: function [[initializer]] {{*}}kind=Initializer{{*}}captures=[{type=undefined|null|string site=[[siteOfA]] flags=[OmitsNull, OmitsUndefined] variableName="a"}] thisType={type=[[instance]] flags=[IsFromCompiler]}

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
