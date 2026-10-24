// A private field added to objects a base constructor returned: no slot, so every access goes by key.
class Base {
  constructor(target) {
    return target;
  }
}

class Derived extends Base {
  #x = 0;
  static get(object) {
    return object.#x;
  }
  static set(object, value) {
    object.#x = value;
  }
  static has(object) {
    return #x in object;
  }
}

const errorNameOf = action => {
  try {
    action();
    return "no error";
  } catch (error) {
    return error.name;
  }
};

const objectWithoutField = {};
console.log("set before", errorNameOf(() => Derived.set(objectWithoutField, 1)), Derived.has(objectWithoutField));

const first = {};
new Derived(first);
console.log("added twice before", errorNameOf(() => new Derived(first)));

const values = [];
let present = 0;
for (let i = 0; i < 100; i++) {
  const object = i % 2 ? { a: i } : {};
  if (Derived.has(object)) present--;
  new Derived(object);
  Derived.set(object, i);
  Derived.set(object, Derived.get(object) + 1);
  if (Derived.has(object)) present++;
  values.push(Derived.get(object));
}
console.log(values.join(" "));
console.log("present", present);

const repeated = {};
new Derived(repeated);
for (let i = 0; i < 100; i++) Derived.set(repeated, i);
console.log("repeated", Derived.get(repeated), Object.keys(repeated).length);
console.log("added twice after", errorNameOf(() => new Derived(repeated)), Derived.get(repeated));
console.log("set after", errorNameOf(() => Derived.set(objectWithoutField, 1)), Derived.has(objectWithoutField));
console.log("get after", errorNameOf(() => Derived.get(objectWithoutField)));
