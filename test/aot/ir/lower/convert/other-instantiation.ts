// RUN(APART): link
// APART-NOT: layout {{*}}name="Foo"{{*}}supertypes=
// APART-NOT: layout {{*}}name="Bar"{{*}}supertypes=
// APART-NOT: layout {{*}}name="Baz"{{*}}supertypes=
// APART-NOT: layout {{*}}name="Animal"{{*}}supertypes=

// RUN(BELOW): link
// BELOW: layout [[animal]] {{*}}name="Animal"
// BELOW: layout {{*}}name="Dog"{{*}}supertypes=[{{*}}[[animal]]]

// The instantiations of `Box` have one layout and give one position. What one of them holds says nothing of what another holds, and a `Box<Dog>` that is cast to a `Box<Animal>` still says that a Dog is held as an Animal.
interface Box<T> {
  value: T;
}

class Foo {
  foo = 1;
}

class Bar {
  bar = 2;
}

class Baz {
  baz = 3;
}

class Animal {
  name = "";
}

class Dog {
  name = "";
  bark = 1;
}

declare function makeFoo(): Box<Foo>;
declare function makeBar(): Box<Bar>;
declare function makeBaz(): Box<Baz>;
declare function makeDog(): Box<Dog>;

const first: Box<Foo> = makeFoo();
const second: Box<Bar> = makeBar();
const third = makeBaz();
const fourth = makeDog() as Box<Animal>;
console.log(first, second, third, fourth, new Foo(), new Bar(), new Baz(), new Animal(), new Dog());

export function assigned(box: Box<Bar>) {
  let held: Box<Bar>;
  held = box;
  return held;
}
