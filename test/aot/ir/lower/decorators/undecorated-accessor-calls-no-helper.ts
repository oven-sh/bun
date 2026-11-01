// RUN: lower
// CHECK-NOT: CompilerHelpers
// CHECK: DefineMethod {{*}}methodKind=Getter key="a"
// CHECK-NOT: CompilerHelpers

export class C {
  accessor a = 1;
}
