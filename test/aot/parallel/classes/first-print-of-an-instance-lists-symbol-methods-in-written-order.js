// console.log lists the methods of an instance's class in the order in which the class body has them, a method under a symbol among the others.
// Nothing has looked at the prototype of any of these classes when its first instance is printed, and the second print is the same as the first.
const tag = Symbol("tag");

class SymbolFirst {
  [Symbol.iterator]() {}
  size() {}
}
console.log(new SymbolFirst());
console.log(new SymbolFirst());

class SymbolBetween {
  first() {}
  [tag]() {}
  last() {}
}
console.log(Bun.inspect(new SymbolBetween()));
console.log(Bun.inspect(new SymbolBetween()));

class Base {
  [Symbol.asyncIterator]() {}
  base() {}
}
class Derived extends Base {
  [tag]() {}
  derived() {}
  [Symbol.iterator]() {}
}
console.log(new Derived());
console.log(new Derived());

class WithFields {
  x = 1;
  [tag] = 2;
  y = 3;
  [Symbol.iterator]() {}
  size() {}
}
console.log(new WithFields());
console.log(new WithFields());

class WithGetter {
  [Symbol.iterator]() {}
  get size() {
    return 1;
  }
  clear() {}
}
console.log(new WithGetter());
console.log(new WithGetter());

class WithNumber {
  [Symbol.iterator]() {}
  size() {}
  1() {}
}
console.log(new WithNumber());
console.log(new WithNumber());

class BelowGetter extends WithGetter {
  [tag]() {}
  more() {}
}
console.log(new BelowGetter());
console.log(new BelowGetter());

function make(name) {
  return class {
    [Symbol.iterator]() {}
    [name]() {}
    [tag]() {}
    size() {}
  };
}
for (const name of ["a", "b"]) {
  const Made = make(name);
  console.log(new Made());
  console.log(new Made());
}

class Inner {
  [Symbol.iterator]() {}
  size() {}
}
console.log({ list: [new Inner()], map: new Map([["k", new Inner()]]) });

class Called {
  [Symbol.iterator]() {
    return [1, 2][Symbol.iterator]();
  }
  size() {
    return 2;
  }
}
const called = new Called();
console.log(called.size(), [...called]);
console.log(called);
console.log(called);

class OfPrototype {
  [Symbol.iterator]() {}
  size() {}
}
console.log(Object.create(OfPrototype.prototype));
console.log(OfPrototype.prototype);

class BelowArray extends Array {
  [tag]() {}
  size() {}
}
console.log(new BelowArray());
console.log(new BelowArray());
