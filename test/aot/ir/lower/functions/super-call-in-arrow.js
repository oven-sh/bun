// RUN: link
// CHECK: layout [[derived]] kind=Instance name="Derived" module=[[entry]]
// CHECK: layout [[environment]] kind=Environment module=[[entry]] fields=[{key=@"this.0" declared={type=absent|[[derived]] flags=[IsFromCompiler]}
// CHECK: module [[entry]] path="{{*}}super-call-in-arrow"
// CHECK: function [[constructor]] name="Derived" module=[[entry]] {{*}}kind=DerivedConstructor
// CHECK: = NewObject layout=[[environment]]
// CHECK: function [[arrow]] name="callSuper" module=[[entry]] {{*}}kind=Arrow{{*}}captures=[{type=env [[environment]] flags=[IsFromCompiler]}
// CHECK: [[object]] = SuperConstruct
// CHECK-NEXT: [[instance]] = Convert [[object]] declared={type=[[derived]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: [[old]] = GetEnvironmentField [[captured]] layout=[[environment]]
// CHECK-NEXT: = TypeTest [[old]] testedType=absent
// CHECK: PutEnvironmentField [[captured]], [[instance]] layout=[[environment]]

class Base {}

export class Derived extends Base {
  constructor() {
    const callSuper = () => super();
    callSuper();
  }
}
