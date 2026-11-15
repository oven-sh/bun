// RUN: link
// CHECK: layout {{*}}name="Dog"
// CHECK-NOT: supertypes=
// CHECK: layout [[animal]] module={{*}}fields=[{key="name"
// CHECK: function {{*}}name="f" {{*}}parameters=
// CHECK: = Convert {{*}}declared={type=undefined|null|Array<undefined|null|[[animal]]> flags=

// An initializer adds nothing to a family, neither for the array nor for what it holds: Dog does not declare that it implements Animal, so it does not go below Animal.
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
