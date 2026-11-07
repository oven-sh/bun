// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[class]] = FinishClass
// CHECK: PutModuleVariable [[class]] variable=[[inner]] @
// CHECK: PutModuleVariable [[class]] variable=[[outer]] @
// CHECK: [[decorate]] = Builtin builtin=CompilerHelpersDecorateClass
// CHECK: [[decorated]] = Call [[decorate]],
// CHECK: PutModuleVariable [[decorated]] variable=[[outer]] @
// CHECK-LABEL: function {{*}}name="m"
// CHECK: = GetModuleVariable variable=[[inner]] @
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: = GetModuleVariable variable=[[outer]] @
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: = GetModuleVariable variable=[[outer]] @

declare const d: any;

@d
class C {
  @d(() => C) p = 1;
  m(@d(() => C) a: number) {
    return C;
  }
}
