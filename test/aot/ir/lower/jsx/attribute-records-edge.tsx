// RUN: link
// CHECK: layout {{*}}name="Dog"{{*}}supertypes=[{{*}}[[animal]]]
// CHECK: layout [[animal]] name="Animal"

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
