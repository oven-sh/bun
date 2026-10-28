// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: CompilerHelpers
// CHECK: = FinishClass
// CHECK: builtin=CompilerHelpersCreateDecoratorMetadata
// CHECK: [[method]] = String string="method"
// CHECK: [[createMethod]] = Builtin builtin=CompilerHelpersCreateElement
// CHECK: = Call [[createMethod]], -, [[method]],
// CHECK: builtin=CompilerHelpersApplyMethodDecorators
// CHECK: [[getter]] = String string="getter"
// CHECK: [[createGetter]] = Builtin builtin=CompilerHelpersCreateElement
// CHECK: = Call [[createGetter]], -, [[getter]],
// CHECK: builtin=CompilerHelpersApplyMethodDecorators
// CHECK: [[setter]] = String string="setter"
// CHECK: [[createSetter]] = Builtin builtin=CompilerHelpersCreateElement
// CHECK: = Call [[createSetter]], -, [[setter]],
// CHECK: builtin=CompilerHelpersApplyMethodDecorators
// CHECK: [[accessor]] = String string="accessor"
// CHECK: [[createAccessor]] = Builtin builtin=CompilerHelpersCreateElement
// CHECK: = Call [[createAccessor]], -, [[accessor]],
// CHECK: builtin=CompilerHelpersApplyAccessorDecorators
// CHECK: [[field]] = String string="field"
// CHECK: [[createField]] = Builtin builtin=CompilerHelpersCreateElement
// CHECK: = Call [[createField]], -, [[field]],
// CHECK: builtin=CompilerHelpersApplyFieldDecorators
// CHECK: builtin=CompilerHelpersSetDecoratorMetadata
// CHECK-NOT: CompilerHelpers
// CHECK: Return

// RUN(PRIVATE): lower
// PRIVATE-NOT: CompilerHelpersApplyPrivate
// PRIVATE-NOT: CompilerHelpersCreatePrivateStorage

declare const d: any;

export class C {
  @d m() {}
  @d get g() {
    return 1;
  }
  @d set s(v: number) {}
  @d accessor a = 1;
  @d f = 2;
}
