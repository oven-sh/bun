// RUN(METHOD): link
// METHOD: layout [[layout]] kind=Instance name="WithMethod"
// METHOD: function {{*}}kind=Initializer{{*}}thisType={type=[[layout]]}
// METHOD: b0([[received]]
// METHOD: [[this]] = Convert [[received]] declared={type=object flags=[IsFromCompiler, IsClaim]}
// METHOD-NOT: PropDefine
// METHOD: [[found]] = ElemGet
// METHOD: = TypeTest [[found]] testedType=undefined
// METHOD: b{{*}}([[list]]):
// METHOD: [[run]] = Builtin builtin=CompilerHelpersRunInitializers
// METHOD: = Call [[run]], -, [[list]], [[this]]
// METHOD: PropDefine [[this]], {{*}}key="x"

// RUN(FIELD): link
// FIELD: layout [[layout]] kind=Instance name="WithField"
// FIELD: function {{*}}kind=Initializer{{*}}thisType={type=[[layout]]}
// FIELD-NOT: CompilerHelpersRunInitializers
// FIELD: PropDefine {{*}}key="f"

declare const d: any;

export class WithMethod {
  x = 1;
  @d m() {}
}

export class WithField {
  @d f = 1;
}
