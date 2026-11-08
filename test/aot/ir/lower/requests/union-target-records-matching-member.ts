// RUN: link
// CHECK: layout {{*}}name="C"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[matching]]]
// CHECK: layout [[matching]] {{*}}fields=[{key="a"

// RUN(SECOND): link
// SECOND: layout {{*}}name="D"{{*}}supertypes=[
// SECOND-NOT: ,
// SECOND: [[matching]]]
// SECOND: layout [[matching]] {{*}}fields=[{key="b"

// A cast puts the type of its operand below the type that is written. Where that is a union, each class goes below the member that takes it and below no other.
interface A {
  a: number;
}

interface B {
  b: number;
}

class C {
  a = 1;
}

class D {
  b = 2;
}

export function both(x: C | D) {
  return x as A | B;
}

export const v = new C() as A | B;

export const w = both(new D());
