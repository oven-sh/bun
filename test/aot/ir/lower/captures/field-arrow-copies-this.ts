// RUN: link
// CHECK: layout [[instance]] kind=Instance name="C"
// CHECK-LABEL: function {{*}}name="C"
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: b0([[this]]: [[instance]]):
// CHECK: [[object]] = Convert [[this]] declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NOT: = NewObject
// CHECK: [[closure]] = NewClosure [[this]] function=
// CHECK-NEXT: [[typed]] = Convert [[closure]] declared={type=undefined|null|f{{*}} flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine [[object]], [[typed]] key="onClick"
// CHECK-LABEL: function {{*}}name="onClick"
// CHECK: captures=[{type=[[instance]] variableName="this"}] thisType

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: env L

export class C {
  n = 0;
  onClick = () => this.n++;
}
