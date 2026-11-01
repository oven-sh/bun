// RUN: lower
// CHECK: function {{*}}kind=Initializer
// CHECK-NOT: Define
// CHECK: PropSet {{*}}key="-1"
// CHECK-NOT: Define
// CHECK: PropSet {{*}}key="a"
// CHECK-NOT: Define
// CHECK: function {{*}}kind=Initializer
// CHECK-NOT: Define
// CHECK: ElemSet
// CHECK-NOT: Define
// CHECK: PropSet {{*}}key="b"
// CHECK-NOT: Define
// CHECK: function {{*}}kind=Initializer
// CHECK: ElemDefine
// CHECK: PropDefine {{*}}key="c"
// CHECK: PropDefine {{*}}key="unset"

const first = "first";
declare function f(): void;
f();
let variable = "variable";

export class SignedNumber {
  [-1] = 1;
  a = 2;
  unset?: number;
}

export class FirstConstant {
  [first] = 1;
  b = 2;
  unset?: number;
}

export class Variable {
  [variable] = 1;
  c = 2;
  unset?: number;
}
