// A class or a class in it declares the name that Bun's transpiler would give to the field of an `accessor #x`: the field takes a number, and a message that quotes a read of `#x` has that name.
const lines = [];
function tell(label, run) {
  try {
    lines.push(label + ": no error " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name + ": " + error.message);
  }
}
const none = [null][0];
class Taken {
  #level_accessor_storage = 1;
  accessor #level = none;
  read() {
    return this.#level.x + this.#level_accessor_storage;
  }
}
tell("the class declares the name", () => new Taken().read());
class Outer {
  accessor #depth = none;
  static inner() {
    return class Inner {
      #depth_accessor_storage = 2;
      static read(outer) {
        return outer.#depth.x;
      }
    };
  }
}
tell("a class in it declares the name", () => Outer.inner().read(new Outer()));
console.log(lines.join("\n"));
