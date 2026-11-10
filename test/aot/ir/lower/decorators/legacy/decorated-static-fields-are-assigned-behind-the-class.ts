// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[class]] = FinishClass
// CHECK: = CallDirect
// CHECK: PutModuleVariable {{*}}variable=[[outer]] @
// CHECK: PropSet [[class]], {{*}}key="b"
// CHECK: [[arrow]] = NewClosure function=
// CHECK: PropSet [[class]], [[arrow]] key="c"
// CHECK: = Builtin builtin=CompilerHelpersDecorateProperty
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: PropDefine {{*}}key="a"
// CHECK-NOT: key="b"
// CHECK-NOT: key="c"
// CHECK: Return
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: = GetModuleVariable variable=[[outer]] @
// CHECK: [[this]] = Undefined
// CHECK: = NewArray {{*}}, [[this]]

declare const d: any;
declare function f(): number;

export class C {
  static a = f();
  @d static b = f();
  @d static c = () => [C, this];
}
