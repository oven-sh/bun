// RUN: lower
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: [[read]] = PropGet {{*}}key="v"
// CHECK-NEXT: [[converted]] = Convert [[read]] declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: PropDefine [[this]], [[converted]] key="x"
// CHECK-NOT: Convert
// CHECK: [[untyped]] = PropGet {{*}}key="v"
// CHECK-NOT: Convert
// CHECK: PropDefine [[this]], [[untyped]] key="y"

declare const v: any;

export class C {
  x: number = v;
  y = v;
}
