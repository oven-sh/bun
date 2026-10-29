// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = FinishClass
// CHECK-COUNT-3: builtin=CompilerHelpersApplyPrivateMethodDecorators
// CHECK: [[createStorage]] = Builtin builtin=CompilerHelpersCreatePrivateStorage
// CHECK: [[storage]] = Call [[createStorage]], -, [[test]], [[get]], [[set]] @
// CHECK: [[applyAccessor]] = Builtin builtin=CompilerHelpersApplyPrivateAccessorDecorators
// CHECK: = Call [[applyAccessor]], -, {{*}}, [[storage]],
// CHECK: builtin=CompilerHelpersCreatePrivateStorage
// CHECK: builtin=CompilerHelpersApplyPrivateFieldDecorators
// CHECK: Return

// RUN(PUBLIC): lower
// PUBLIC-NOT: CompilerHelpersApplyMethodDecorators
// PUBLIC-NOT: CompilerHelpersApplyAccessorDecorators
// PUBLIC-NOT: CompilerHelpersApplyFieldDecorators

// RUN(TEST): lower
// TEST-LABEL: function {{*}}name="#f" {{*}}kind=Method
// TEST-NOT: function f
// TEST: = PrivateHas

// RUN(GET): lower
// GET-LABEL: function {{*}}name="#f" {{*}}kind=Getter
// GET-NOT: function f
// GET: = PrivateGet

// RUN(SET): lower
// SET-LABEL: function {{*}}name="#f" {{*}}kind=Setter
// SET-NOT: function f
// SET: PrivateSet

declare const d: any;

export class C {
  @d #m() {}
  @d get #g() {
    return 1;
  }
  @d set #s(v: number) {}
  @d accessor #a = 1;
  @d #f = 2;
}
