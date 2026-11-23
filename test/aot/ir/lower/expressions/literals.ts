// RUN: lower
// CHECK-LABEL: function {{*}}name="bigInteger"
// CHECK: = BigInt digits="10"
// CHECK-LABEL: function {{*}}name="fraction"
// CHECK: = Double number=1.5
// CHECK-LABEL: function {{*}}name="largestTracked"
// CHECK-NOT: = Double
// CHECK: = Integer integer=4611686018427387392
// CHECK-LABEL: function {{*}}name="minusOne"
// CHECK-NOT: = Negate
// CHECK: = Integer integer=-1
// CHECK-NOT: = Negate
// CHECK-LABEL: function {{*}}name="negativeZero"
// CHECK-NOT: = Integer
// CHECK: = Double number=-0
// CHECK-NOT: = Integer
// CHECK-LABEL: function {{*}}name="nothing"
// CHECK: = Null
// CHECK-LABEL: function {{*}}name="one"
// CHECK: = Integer integer=1
// CHECK-LABEL: function {{*}}name="pastTrackedRange"
// CHECK-NOT: = Integer
// CHECK: = Double number=4611686018427
// CHECK-LABEL: function {{*}}name="text"
// CHECK: = String string="a"
// CHECK-LABEL: function {{*}}name="truth"
// CHECK: = Boolean boolean=true

export function bigInteger() {
  return 10n;
}

export function fraction() {
  return 1.5;
}

export function largestTracked() {
  return 4611686018427387392;
}

export function minusOne() {
  return -1;
}

export function negativeZero() {
  return -0;
}

export function nothing() {
  return null;
}

export function one() {
  return 1;
}

export function pastTrackedRange() {
  return 4611686018427387904;
}

export function text() {
  return "a";
}

export function truth() {
  return true;
}
