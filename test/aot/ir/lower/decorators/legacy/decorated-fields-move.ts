// RUN: lower
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: b0([[this]]
// CHECK: PropDefine [[this]], {{*}}key="a"
// CHECK-NOT: key="b"
// CHECK: PropDefine [[this]], {{*}}key="c"
// CHECK: PropSet [[this]], {{*}}key="b"
// CHECK: Return

declare const d: any;

export class C {
  a = 1;
  @d b = 2;
  c = 3;
}
