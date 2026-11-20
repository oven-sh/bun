// Classes as values: in variables, in objects, made in a function, named inside
const registry = {
  small: class {
    size = 1;
  },
  Big: class Inner {
    size = 100;
    static make() {
      return new Inner();
    }
  },
};
function define(factor) {
  return class Scaled extends registry.Big {
    size = super.constructor === undefined ? 0 : factor * 2;
    label() {
      return Scaled.name + this.size;
    }
  };
}
function run(factor) {
  const Type = define(factor);
  return [new registry.small().size, registry.small.name, registry.Big.make().size, registry.Big.name, new Type().label(), Type === define(factor), Type.make().size].join();
}
console.log(run(1));
console.log(run(21));
console.log(run(0));
