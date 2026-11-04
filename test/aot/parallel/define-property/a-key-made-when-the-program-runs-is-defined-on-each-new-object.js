// `Object.defineProperty(this, key, { writable: true, value: void 0 })` in a constructor, under a key that is put together when the program starts: what Babel emits for
// `#x` in loose mode. No layout has the name. The second object of a kind gets it as the first did, and an object in any other state gets it in its own way.
let made = 0;
function keyFor(name) {
  return "__private_" + made++ + "_" + name;
}
const first = keyFor("first");
const second = keyFor("second");
const mark = Symbol("mark");
function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => {
      const found = Object.getOwnPropertyDescriptor(object, key);
      const flags = (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
      return String(key) + "=" + ("value" in found ? String(found.value) : "accessor") + flags;
    })
    .join(" ");
}
class Holder {
  constructor(value, way) {
    this.before = value;
    if (way === "closed") Object.preventExtensions(this);
    if (way === "other first") this.other = 1;
    if (way === "there already") this[first] = "there";
    Object.defineProperty(this, first, { writable: true, value: void 0 });
    this[first] = value;
    if (way === "listed") Object.defineProperty(this, second, { value, enumerable: true });
    else if (way === "accessor") Object.defineProperty(this, second, { get: () => value, configurable: true });
    else if (way !== "one") Object.defineProperty(this, second, { value, configurable: true });
    if (way === "symbol") Object.defineProperty(this, mark, { value, writable: true });
    this.after = value;
  }
  get() {
    return this[first];
  }
}
let sum = 0;
for (let turn = 0; turn < 1000; turn++) sum += new Holder(turn & 7).get();
console.log(sum, describe(new Holder(1)));
const lines = [];
for (const way of ["one", "listed", "accessor", "symbol", "other first", "there already", "closed", "one", "listed", undefined]) {
  for (let twice = 0; twice < 2; twice++) {
    try {
      lines.push(way + ": " + describe(new Holder(twice, way)));
    } catch (error) {
      lines.push(way + ": " + error.constructor.name);
    }
  }
}
class Heir extends Holder {
  constructor(value) {
    super(value);
    Object.defineProperty(this, keyFor("heir").replace(/\d+/, "n"), { value });
  }
}
lines.push(describe(new Heir(1)), describe(new Heir(2)));
const asPrototype = new Holder(5, "one");
const below = Object.create(asPrototype);
lines.push(below[first] + " " + (second in below));
Object.defineProperty(asPrototype, second, { value: "late" });
lines.push(below[second] + " " + describe(asPrototype));
const deleted = new Holder(6);
delete deleted[second];
Object.defineProperty(deleted, second, { value: "again", configurable: true });
lines.push(describe(deleted));
const frozen = Object.freeze(new Holder(7, "one"));
try {
  Object.defineProperty(frozen, second, { value: 1 });
} catch (error) {
  lines.push("frozen: " + error.constructor.name + " " + describe(frozen));
}
const many = [];
for (let turn = 0; turn < 300; turn++) {
  many.push(new Holder(turn));
  if (turn % 100 === 50 && typeof Bun !== "undefined") Bun.gc(true);
}
lines.push(many.every((holder, turn) => holder.get() === turn && holder[second] === turn && Object.keys(holder).join() === "before,after"));
console.log(lines.join("\n"));
