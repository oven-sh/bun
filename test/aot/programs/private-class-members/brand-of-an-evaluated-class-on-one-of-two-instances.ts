// Two instances of one compiled class. An evaluated subclass made one of them, so only that one has the subclass's brand and private field.
class Base {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}
const Derived = (0, eval)(`(function (Base) {
  return class Derived extends Base {
    #field = "field";
    #method() { return "method " + this.id; }
    get #accessor() { return "accessor " + this.id; }
    static call(object) { return object.#method(); }
    static read(object) { return object.#field; }
    static get(object) { return object.#accessor; }
    static write(object, value) { object.#field = value; return object.#field; }
    static hasMethod(object) { return #method in object; }
    static hasField(object) { return #field in object; }
  };
})`)(Base);

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

const branded = new Derived(1);
const plain = new Base(2);
const later = new Base(3);
for (const name of ["call", "read", "get", "hasMethod", "hasField"]) {
  const seen = new Set<string>();
  for (let turn = 0; turn < 200; turn++) {
    seen.add(attempt(() => Derived[name](branded)) + " | " + attempt(() => Derived[name](plain)) + " | " + attempt(() => Derived[name](turn % 2 ? branded : later)));
  }
  console.log(name + ": " + [...seen].join(" ; "));
}
const written = new Set<string>();
for (let turn = 0; turn < 200; turn++)
  written.add(attempt(() => Derived.write(branded, "again")) + " | " + attempt(() => Derived.write(plain, "never")));
console.log("write: " + [...written].join(" ; "));
console.log(Object.keys(branded).join(","), Object.keys(plain).join(","), branded instanceof Base, plain instanceof Derived);
