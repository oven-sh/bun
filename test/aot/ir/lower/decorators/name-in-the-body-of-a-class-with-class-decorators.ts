// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[nothing]] = Undefined
// CHECK: = Call {{*}}, -, [[nothing]] calleeName="note"
// CHECK: [[class]] = FinishClass
// CHECK-NEXT: PutModuleVariable [[class]] variable=[[own]] @
// CHECK: [[apply]] = Builtin builtin=CompilerHelpersApplyClassDecorators
// CHECK-NEXT: [[decorated]] = Call [[apply]], -, {{*}}, [[class]],
// CHECK-NEXT: PutModuleVariable [[decorated]] variable=[[read]] @
// CHECK-LABEL: function {{*}}name="poke"
// CHECK: [[held]] = GetModuleVariable variable=[[own]] @
// CHECK-NEXT: = CheckInitialized [[held]] name="C"
// CHECK: = NewRuntimeError runtimeError=ConstantAssignment name="C"
// CHECK-LABEL: function {{*}}name="self"
// CHECK: [[value]] = GetModuleVariable variable=[[read]] @
// CHECK-NEXT: Return [[value]]

declare const d: any;
declare const note: any;

@d
class C { // @ts-expect-error
  @note(C) field = 1;
  static poke() {
    // @ts-ignore
    C = 1;
  }
  static self() {
    return C;
  }
}

export { C };
