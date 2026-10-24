// RUN: link
// CHECK: layout [[instance]] kind=Instance name="C"
// CHECK-LABEL: function {{*}}name="C"
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: b0([[this]]: [[instance]]):
// CHECK-NOT: = NewObject
// CHECK: [[closure]] = NewClosure [[this]] function=
// CHECK-NEXT: [[onClick]] = Convert [[closure]] declared={type=undefined|null|f{{*}} site=w{{*}}}
// CHECK-NEXT: PropDefine [[this]], [[onClick]] key="onClick"
// CHECK-LABEL: function {{*}}name="onClick"
// CHECK: captures=[{type=[[instance]] flags=[IsFromCompiler]}] thisType

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: env L

export class C {
  n = 0;
  onClick = () => this.n++;
}
