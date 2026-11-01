// The parent is replaced by a function that keeps the object it returns and makes a later field read-only, so the private field keeps what it was defined as.
const kept = [];
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
  const made = {};
  kept.push(made);
  Object.defineProperty(made, "label", { value: "fixed" });
  return made;
});
try {
  new Below(2);
} catch (error) {
  console.log(error.name);
}
console.log(Below.read(kept[0]));
