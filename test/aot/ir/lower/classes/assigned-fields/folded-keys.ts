// RUN: lower
// CHECK-LABEL: function {{*}}name="Sum" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropSet {{*}}key="ab"
// CHECK: PropSet {{*}}key="a"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="Template" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropSet {{*}}key="first-b"
// CHECK: PropSet {{*}}key="b"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="Chosen" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropSet {{*}}key="chosen"
// CHECK: PropSet {{*}}key="l"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="NegatedMember" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropSet {{*}}key="-21"
// CHECK: PropSet {{*}}key="c"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="NotANumber" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropSet {{*}}key="NaN"
// CHECK: PropSet {{*}}key="d"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="Asserted" {{*}}kind=BaseConstructor
// CHECK-NOT: CallDirect
// CHECK: PropSet {{*}}key="asserted"
// CHECK: PropSet {{*}}key="e"
// CHECK-NOT: CallDirect
// CHECK-LABEL: function {{*}}name="LateConstant" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set
// CHECK-LABEL: function {{*}}name="Null" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set
// CHECK-LABEL: function {{*}}name="Member" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set
// CHECK-LABEL: function {{*}}name="ConstantOfMember" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set
// CHECK-LABEL: function {{*}}name="ChosenMember" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set
// CHECK-LABEL: function {{*}}name="MemberBehindOr" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set
// CHECK-LABEL: function {{*}}name="BehindWhatTheBuildAloneKnows" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set
// CHECK-LABEL: function {{*}}name="BesideVariable" {{*}}kind=BaseConstructor
// CHECK-NOT: Set
// CHECK: CallDirect
// CHECK-NOT: Set

const first = "first";
enum Numbers {
  one = 21,
}
const member = Numbers.one;
declare function f(): void;
f();
const late = "late";
let variable = "variable";

export class Sum {
  // @ts-expect-error
  ["a" + "b"] = 1;
  a = 2;
  unset?: number;
}

export class Template {
  // @ts-expect-error
  [`${first}-b`] = 1;
  b = 2;
  unset?: number;
}

export class Chosen {
  // @ts-expect-error
  [1 < 2 ? "chosen" : "other"] = 1;
  l = 2;
  unset?: number;
}

export class NegatedMember {
  // @ts-expect-error
  [-Numbers.one] = 1;
  c = 2;
  unset?: number;
}

export class NotANumber {
  [NaN] = 1;
  d = 2;
  unset?: number;
}

export class Asserted {
  // @ts-expect-error
  ["asserted" as string] = 1;
  e = 2;
  unset?: number;
}

export class LateConstant {
  [late] = 1;
  g = 2;
  unset?: number;
}

export class Null {
  // @ts-expect-error
  [null as any] = 1;
  h = 2;
  unset?: number;
}

export class Member {
  [Numbers.one] = 1;
  i = 2;
  unset?: number;
}

export class ConstantOfMember {
  [member] = 1;
  j = 2;
  unset?: number;
}

export class ChosenMember { // @ts-expect-error
  [true ? Numbers.one : 0] = 1;
  m = 2;
  unset?: number;
}

export class MemberBehindOr { // @ts-expect-error
  [0 || Numbers.one] = 1;
  n = 2;
  unset?: number;
}

export class BehindWhatTheBuildAloneKnows {
  // @ts-expect-error
  [0x0n || "behind"] = 1;
  o = 2;
  unset?: number;
}

export class BesideVariable {
  // @ts-expect-error
  ["a" + "b"] = 1;
  [variable] = 2;
  k = 3;
  unset?: number;
}
