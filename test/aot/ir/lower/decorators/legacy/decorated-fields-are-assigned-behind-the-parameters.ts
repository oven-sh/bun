// RUN: lower
// CHECK-LABEL: function {{*}}kind=BaseConstructor
// CHECK: b0([[newTarget]]: anything, [[p]]:
// CHECK: [[this]] = Convert
// CHECK: = CallDirect [[this]] function=
// CHECK: = TypeTest [[p]] testedType=undefined
// CHECK: = Call {{*}}calleeName="f"
// CHECK: PropSet [[this]], [[newTarget]] key="b"
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: PropDefine {{*}}key="a"
// CHECK-NOT: key="b"
// CHECK: PropDefine {{*}}key="c"
// CHECK-NOT: key="b"
// CHECK: Return

declare const d: any;
declare function f(): number;

export class C {
  a = 1;
  @d b = new.target;
  c = 3;
  constructor(p = f()) {}
}
