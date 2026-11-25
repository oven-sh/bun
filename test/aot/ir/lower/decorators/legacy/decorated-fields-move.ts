// RUN: lower
// CHECK-LABEL: function {{*}}kind=BaseConstructor
// CHECK: [[made]] = Convert
// CHECK: = CallDirect [[made]] function=
// CHECK: PropSet [[made]], {{*}}key="b"
// CHECK: Return [[made]]
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: b0([[received]]
// CHECK: [[this]] = Convert [[received]] declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK: PropDefine [[this]], {{*}}key="a"
// CHECK-NOT: key="b"
// CHECK: PropDefine [[this]], {{*}}key="c"
// CHECK-NOT: key="b"
// CHECK: Return

declare const d: any;

export class C {
  a = 1;
  @d b = 2;
  c = 3;
}
