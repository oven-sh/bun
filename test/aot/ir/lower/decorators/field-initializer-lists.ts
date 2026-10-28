// RUN(INSTANCE): lower
// INSTANCE-LABEL: function {{*}}kind=Initializer{{*}}thisType={type=L{{*}} flags=[IsFromCompiler]}
// INSTANCE: b0([[received]]
// INSTANCE: [[this]] = Convert [[received]] declared={type=object flags=[IsFromCompiler, IsClaim]}
// INSTANCE: [[initial]] = Call {{*}}calleeName="f"
// INSTANCE: [[values]] = ElemGet
// INSTANCE: [[runValues]] = Builtin builtin=CompilerHelpersRunValueInitializers
// INSTANCE: [[value]] = Call [[runValues]], -, [[values]], [[this]], [[initial]]
// INSTANCE: PropDefine [[this]], [[value]] key="a"
// INSTANCE: [[extra]] = ElemGet
// INSTANCE: [[run]] = Builtin builtin=CompilerHelpersRunInitializers
// INSTANCE: = Call [[run]], -, [[extra]], [[this]]
// INSTANCE: PropDefine [[this]], {{*}}key="last"
// INSTANCE-NOT: CompilerHelpersRunInitializers
// INSTANCE: Return

// RUN(LAST): lower
// LAST-LABEL: function {{*}}name="C"{{*}}kind=BaseConstructor
// LAST: = CallDirect [[this]] function=
// LAST: [[extra]] = ElemGet
// LAST: [[run]] = Builtin builtin=CompilerHelpersRunInitializers
// LAST: = Call [[run]], -, [[extra]], [[this]]
// LAST: Return [[this]]

// RUN(STATIC): lower
// STATIC-LABEL: function {{*}}kind=Initializer{{*}}thisType={type=function flags=[IsFromCompiler]}
// STATIC: b0([[received]]
// STATIC: [[class]] = Convert [[received]] declared={type=object flags=[IsFromCompiler, IsClaim]}
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
  @d last = 1;
  @d static b = 1;
}
