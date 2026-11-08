// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: CompilerHelpers
// CHECK: [[class]] = FinishClass
// CHECK: [[m]] = String string="m"
// CHECK: [[decorateM]] = Builtin builtin=CompilerHelpersDecorateMethod
// CHECK: = Call [[decorateM]], -, {{*}}, [[m]] @
// CHECK: [[p]] = String string="p"
// CHECK: [[decorateP]] = Builtin builtin=CompilerHelpersDecorateProperty
// CHECK: = Call [[decorateP]], -, {{*}}, [[p]] @
// CHECK: [[s]] = String string="s"
// CHECK: [[decorateS]] = Builtin builtin=CompilerHelpersDecorateMethod
// CHECK: = Call [[decorateS]], -, {{*}}, [[class]], [[s]] @
// CHECK: [[decorateClass]] = Builtin builtin=CompilerHelpersDecorateClass
// CHECK: = Call [[decorateClass]], -, {{*}}, [[class]] @
// CHECK-NOT: CompilerHelpers
// CHECK: Return

declare const d: any;

@d
class C {
  @d m() {}
  @d static s() {}
  @d p = 1;
}

export { C };
