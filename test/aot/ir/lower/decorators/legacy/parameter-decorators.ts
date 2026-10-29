// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[class]] = FinishClass
// CHECK: [[zero]] = Integer @
// CHECK: [[decorateFirst]] = Builtin builtin=CompilerHelpersDecorateParameter
// CHECK: [[first]] = Call [[decorateFirst]], -, [[zero]],
// CHECK: [[one]] = Integer integer=1
// CHECK: [[decorateSecond]] = Builtin builtin=CompilerHelpersDecorateParameter
// CHECK: [[second]] = Call [[decorateSecond]], -, [[one]],
// CHECK: [[methodList]] = NewArray [[first]], [[second]] contents=
// CHECK: [[decorateMethod]] = Builtin builtin=CompilerHelpersDecorateMethod
// CHECK: = Call [[decorateMethod]], -, [[methodList]],
// CHECK: [[decorateThird]] = Builtin builtin=CompilerHelpersDecorateParameter
// CHECK: [[third]] = Call [[decorateThird]],
// CHECK: [[classList]] = NewArray [[third]] contents=
// CHECK: [[decorateClass]] = Builtin builtin=CompilerHelpersDecorateClass
// CHECK: = Call [[decorateClass]], -, [[classList]], [[class]] @

declare const d: any;

export class C {
  constructor(@d x: unknown) {}
  m(@d a: unknown, @d b: unknown) {}
}
