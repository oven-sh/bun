// The constructor stores a field that nothing reads. Later the parent is replaced by a function that returns a plain object, which gets the same fields.
class Evaluated extends Function {
  constructor() {
    super("return 7");
  }
}
console.log(new Evaluated()());
class Above {}
class Below extends Above {
  #count;
  label;
  constructor(count) {
    super();
    this.#count = count;
    this.label = "s";
  }
  static read(object) {
    return object.#count;
  }
}
console.log(Below.read(new Below(1)));
Object.setPrototypeOf(Below, function () {
  return {};
});
console.log(Below.read(new Below(2)));
