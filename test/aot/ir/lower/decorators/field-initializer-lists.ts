// RUN(INSTANCE): lower
// INSTANCE-LABEL: function {{*}}kind=Initializer{{*}}thisType={type=L{{*}} flags=[IsFromCompiler]}
// INSTANCE: b0([[this]]
// INSTANCE: [[initial]] = Call {{*}}calleeName="f"
// INSTANCE: [[values]] = ElemGet
// INSTANCE: [[runValues]] = Builtin builtin=CompilerHelpersRunValueInitializers
// INSTANCE: [[value]] = Call [[runValues]], -, [[values]], [[this]], [[initial]]
// INSTANCE: PropDefine [[this]], [[value]] key="a"
// INSTANCE: [[extra]] = ElemGet
// INSTANCE: [[run]] = Builtin builtin=CompilerHelpersRunInitializers
// INSTANCE: = Call [[run]], -, [[extra]], [[this]]
// INSTANCE: Return

// RUN(STATIC): lower
// STATIC-LABEL: function {{*}}kind=Initializer{{*}}thisType={type=function flags=[IsFromCompiler]}
// STATIC: b0([[class]]
// STATIC-NOT: PutModuleVariable
// STATIC: [[values]] = ElemGet
// STATIC: [[runValues]] = Builtin builtin=CompilerHelpersRunValueInitializers
// STATIC: = Call [[runValues]], -, [[values]], [[class]],
// STATIC: PropDefine [[class]], {{*}}key="b"
// STATIC: [[extra]] = ElemGet
// STATIC: [[run]] = Builtin builtin=CompilerHelpersRunInitializers
// STATIC: = Call [[run]], -, [[extra]], [[class]]
// STATIC-NOT: PutModuleVariable
// STATIC: Return

declare const d: any;
declare function f(): unknown;

export class C {
  @d a = f();
  @d static b = 1;
}
