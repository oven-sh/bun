// RUN: lower
// CHECK-LABEL: function {{*}}name="C"{{*}}kind=BaseConstructor
// CHECK: = CallDirect [[this]] function=
// CHECK: [[extra]] = ElemGet
// CHECK: [[run]] = Builtin builtin=CompilerHelpersRunInitializers
// CHECK: = Call [[run]], -, [[extra]], [[this]]
// CHECK: PropSet [[this]], {{*}}key="n"
// CHECK: Return

declare const d: any;

export class C {
  @d last = 1;
  constructor(public n: number) {}
}
