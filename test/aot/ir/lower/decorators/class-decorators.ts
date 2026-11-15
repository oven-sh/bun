// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[decorators]] = NewArray
// CHECK: = NewClass
// CHECK: [[class]] = FinishClass
// CHECK: [[initializers]] = NewArray contents=
// CHECK: [[apply]] = Builtin builtin=CompilerHelpersApplyClassDecorators
// CHECK: [[decorated]] = Call [[apply]], -, [[decorators]], [[class]], {{*}}, [[initializers]] @
// CHECK: = CallDirect
// CHECK: [[run]] = Builtin builtin=CompilerHelpersRunInitializers
// CHECK: = Call [[run]], -, [[initializers]], [[decorated]]

// RUN(METADATA): lower
// METADATA-NOT: CompilerHelpersSetDecoratorMetadata

declare const d: any;

@d
class C {
  static x = 1;
}

export { C };
