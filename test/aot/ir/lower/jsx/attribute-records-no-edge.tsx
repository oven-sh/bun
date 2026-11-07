// A family holds what is declared. An attribute is a flow of a value, so neither class comes to stand below Animal.
// RUN: link
// CHECK-NOT: layout {{*}}name="Dog"{{*}}supertypes=
// CHECK: layout [[animal]] module={{*}}fields=[{key="name"

// RUN(CAST): link
// CAST-NOT: layout {{*}}name="Cat"{{*}}supertypes=

interface Animal {
  name: string;
}

class Dog {
  name = "";
}

class Cat {
  name = "";
}

function C(p: { item: Animal }) {
  return null;
}

export function typed() {
  return <C item={new Dog()} />;
}

export function cast() {
  return <C item={new Cat() as any} />;
}
