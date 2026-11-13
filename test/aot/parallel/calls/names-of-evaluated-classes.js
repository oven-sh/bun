class Base {
  static make() {
    return new this();
  }
}
function define(i) {
  return class Scaled extends Base {
    static size = i;
    label() {
      return Scaled.name + i;
    }
  };
}
function functions(i) {
  return [
    function named() {
      return i;
    },
    class Plain {},
    class {
      static name = "own" + i;
    },
    define(i),
  ];
}
let text = "";
for (let i = 0; i < 60; i++) {
  const Type = define(i);
  const before = Object.getOwnPropertyNames(Type).join();
  const label = new Type().label();
  const descriptor = Object.getOwnPropertyDescriptor(Type, "name");
  const after = Object.getOwnPropertyNames(Type).join();
  const all = functions(i).map((f) => f.name + f.hasOwnProperty("name"));
  const Frozen = Object.freeze(define(i));
  const Deleted = define(i);
  delete Deleted.name;
  const Closed = Object.preventExtensions(define(i));
  if (i % 29 === 0) text += [before, label, descriptor.value, descriptor.writable, descriptor.configurable, after, all, Frozen.name, Deleted.name, Closed.name, Type.make() instanceof Type].join(" ") + "\n";
}
console.log(text);
