// A class evaluated from text at run time adds a private field and a private method to frozen arrays. The arrays stay frozen.
const Stamp = (0, eval)(`(() => {
  class ReturnsArgument { constructor(object) { return object; } }
  return class Stamp extends ReturnsArgument {
    #field = 1;
    #method() { return 2; }
    static read(object) { return object.#field + object.#method(); }
    static has(object) { return #field in object && #method in object; }
  };
})()`);
const OnlyField = (0, eval)(`(() => {
  class ReturnsArgument { constructor(object) { return object; } }
  return class OnlyField extends ReturnsArgument {
    #field = 3;
    static read(object) { return object.#field; }
    static has(object) { return #field in object; }
  };
})()`);
function stamp(name, Class, object) {
  try {
    console.log(name, Class.name, new Class(object) === object, Class.has(object), Class.read(object), Object.isFrozen(object), Object.isExtensible(object));
  } catch (error) {
    console.log(name, Class.name, error.name);
  }
}
function storesInto(array) {
  "use strict";
  const outcomes = [];
  for (const store of [() => (array[0] = 9), () => array.push(3), () => (array.length = 0), () => (array.added = 1), () => delete array[0]]) {
    try {
      store();
      outcomes.push("stored");
    } catch (error) {
      outcomes.push(error.name);
    }
  }
  return outcomes.join();
}
const makers = {
  integers: () => [1, 2],
  empty: () => [],
  doubles: () => [1.5, 2.5],
  objects: () => [{}, "a"],
  holes: () => [1, , 3],
};
for (const [name, make] of Object.entries(makers)) {
  for (const Class of [Stamp, OnlyField]) {
    const frozen = Object.freeze(make());
    stamp(name, Class, frozen);
    console.log(storesInto(frozen), JSON.stringify(frozen), frozen.length);
  }
  const both = Object.freeze(make());
  stamp(name, OnlyField, both);
  stamp(name, Stamp, both);
  stamp(name, Stamp, both);
}
stamp("sealed", Stamp, Object.seal([1, 2]));
stamp("not extensible", Stamp, Object.preventExtensions([1, 2]));
stamp("frozen object", Stamp, Object.freeze({ a: 1 }));
