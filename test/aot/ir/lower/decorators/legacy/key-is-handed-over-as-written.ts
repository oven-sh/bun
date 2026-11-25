// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = ToPropertyKey [[computed]] @
// CHECK: = FinishClass
// CHECK: [[integer]] = Integer integer=5
// CHECK: = Call {{*}}, [[integer]] @
// CHECK: [[fraction]] = Double number=1.5
// CHECK: = Call {{*}}, [[fraction]] @
// CHECK: [[text]] = String string="7"
// CHECK: = Call {{*}}, [[text]] @
// CHECK: [[inBrackets]] = Integer integer=8
// CHECK: = Call {{*}}, [[inBrackets]] @
// CHECK: [[sum]] = Integer integer=2
// CHECK: = Call {{*}}, [[sum]] @
// CHECK: [[big]] = BigInt digits="3"
// CHECK: = Call {{*}}, [[big]] @
// CHECK: = Builtin builtin=CompilerHelpersDecorateMethod
// CHECK-NEXT: = Call {{*}}, [[computed]] @

declare const d: any;
declare const k: any;

export class C {
  @d 5() {}
  @d 1.5 = 0;
  @d "7"() {}
  @d [8]() {}
  @d [1 + 1]() {}
  @d 3n() {}
  @d [k]() {}
}
