// One class expression is evaluated with an index key in one evaluation and a name in another. An index accessor added later to any of the prototypes
// must reach the arrays, instances and heirs that already inherit from it, and a name added later must reach reads that found nothing before.
const seen = [];
class Base {}
function make(tag, k) {
  return class extends Base {
    get foo() { return "foo"; }
    get [k]() { return "got " + String(k); }
  };
}
function storePastTheEnd(label) {
  const object = { a: 1, __proto__: new Float32Array(4) };
  object[10] = 7;
  console.log(label, Object.keys(object).join(), object[10]);
}
function read(object) { return object.added; }
const classes = ["a", 0, "foo", "foo", 0, "foo", "b", "0"].map((k, at) => make("c" + at, k));
storePastTheEnd("defined");
const below = classes.map(made => {
  const list = [, 1, , 3];
  Object.setPrototypeOf(list, made.prototype);
  const instance = new made();
  const heir = Object.create(made.prototype);
  Reflect.set(instance, 1, "i1");
  Reflect.set(heir, 1, "h1");
  return [list, instance, heir];
});
storePastTheEnd("inherited");
classes.forEach((made, at) => {
  for (const object of below[at]) for (let i = 0; i < 20; i++) read(object);
  Object.defineProperty(made.prototype, 2, { get() { return "late " + at; }, set(value) { seen.push(at + " " + value); }, configurable: true });
  made.prototype.added = "added " + at;
  for (const object of below[at]) {
    const stores = [0, 1, 2, 3].map(index => Reflect.set(object, index, "s" + index));
    console.log(at, stores.join(), [0, 1, 2, 3].map(index => String(object[index])).join(), Object.keys(object).join(), read(object));
  }
});
storePastTheEnd("late");
console.log(seen.join("|"));
