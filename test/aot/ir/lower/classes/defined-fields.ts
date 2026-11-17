// RUN: lower
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: PropDefine [[this]], {{*}}key="a"
// CHECK: [[undefined]] = Undefined
// CHECK-NEXT: PropDefine [[this]], [[undefined]] key="b"
// CHECK: PropDefine [[this]], {{*}}key="c d"
// CHECK: [[index]] = Integer @
// CHECK: ElemDefine [[this]], [[index]],

// RUN(STORES): lower
// STORES-NOT: PropSet
// STORES-NOT: ElemSet

export class C {
  a = 1;
  b: unknown;
  "c d" = 2;
  0 = 3;
}
