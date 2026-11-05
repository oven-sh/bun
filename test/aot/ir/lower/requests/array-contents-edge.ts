// RUN: link
// CHECK: layout {{*}}name="Dog"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[animal]]]
// CHECK: layout [[animal]] name="Animal"

class Dog {
  name = "";
}

interface Animal {
  name: string;
}

export function f(dogs: Dog[]) {
  const a: Animal[] = dogs;
  return a;
}
