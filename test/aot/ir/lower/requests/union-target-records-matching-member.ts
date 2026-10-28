// RUN: link
// CHECK: layout {{*}}name="C"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[matching]]]
// CHECK: layout [[matching]] name="A"
// CHECK: layout {{*}}name="B"

interface A {
  a: number;
}

interface B {
  b: number;
}

class C {
  a = 1;
}

export const v: A | B = new C();
