// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = FinishClass
// CHECK: PutModuleVariable {{*}}variable=[[binding]] @
// CHECK: [[decorate]] = Builtin builtin=CompilerHelpersDecorateClass
// CHECK: = Call [[decorate]],
// CHECK: PutModuleVariable {{*}}variable=[[binding]] @
// CHECK-LABEL: function {{*}}name="create"
// CHECK: = GetModuleVariable variable=[[binding]] @

declare const d: any;

@d
class C {}

export function create() {
  return new C();
}
