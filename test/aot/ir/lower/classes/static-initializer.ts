// RUN: lower
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: b0([[this]]
// CHECK: [[class]] = Convert [[this]] declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK: PropDefine [[class]], {{*}}key="a"
// CHECK-NOT: = Call {{*}}calleeName="f"
// CHECK: = CallDirect function=[[block]]
// CHECK: = PropGet [[this]] key="a"
// CHECK: PropDefine [[class]], {{*}}key="b"
// CHECK: ElemDefine [[class]],
// CHECK: function [[block]] {{*}}kind=Method flags=[IsChecked]
// CHECK: = Call {{*}}calleeName="f"

// RUN(FUNCTIONS): lower
// FUNCTIONS-COUNT-1: kind=Initializer
// FUNCTIONS-NOT: kind=Initializer

// RUN(STORAGE): lower
// STORAGE-LABEL: function {{*}}kind=Initializer
// STORAGE-NOT: PutModuleVariable

declare function f(): void;
declare const k: string;

export class C {
  static a = 1;
  static {
    f();
  }
  static b = this.a;
  static [k] = 2;
}
