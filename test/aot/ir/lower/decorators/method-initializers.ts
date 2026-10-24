// RUN(METHOD): link
// METHOD: layout [[layout]] kind=Instance name="WithMethod"
// METHOD: function {{*}}kind=Initializer{{*}}thisType={type=[[layout]] flags=[IsFromCompiler]}
// METHOD: b0([[this]]
// METHOD-NOT: PropDefine
// METHOD: [[list]] = ElemGet
// METHOD: [[run]] = Builtin builtin=CompilerHelpersRunInitializers
// METHOD: = Call [[run]], -, [[list]], [[this]]
// METHOD: PropDefine [[this]], {{*}}key="x"

// RUN(FIELD): link
// FIELD: layout [[layout]] kind=Instance name="WithField"
// FIELD: function {{*}}kind=Initializer{{*}}thisType={type=[[layout]] flags=[IsFromCompiler]}
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
