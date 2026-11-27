// Fields of a derived class as other compilers lower them: a helper defines them on `this` behind super().
function defineField(object, key, value) {
  if (key in object) {
    Object.defineProperty(object, key, { value: value, enumerable: true, configurable: true, writable: true });
  } else {
    object[key] = value;
  }
  return object;
}

class Base {
  constructor(id) {
    this.id = id;
  }
}

class Derived extends Base {
  constructor(id) {
    const begin = () => super(id);
    begin();
    defineField(this, "label", "item " + id);
    defineField(this, "describe", () => this.id + " " + this.label);
  }
}

console.log(new Derived(1).describe(), new Derived(3).describe());
