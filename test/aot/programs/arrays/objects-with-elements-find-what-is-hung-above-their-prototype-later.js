// An object that already holds elements gets a proxy, or an accessor under an index, somewhere above it: from then on a hole is read through what was hung there and a store to a new index asks it first. Each case has another kind of object below: an instance, the prototype object itself, an instance of a class below Array, what Object.create() made, what Reflect.construct() made for another new.target.
const log = [];
function traps(label) {
  return {
    get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) { log.push(label + " get " + key); return "from above " + key; } return Reflect.get(target, key, receiver); },
    set(target, key, value, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) { log.push(label + " set " + key); return true; } return Reflect.set(target, key, value, receiver); },
    has(target, key) { if (typeof key === "string" && /^\d+$/.test(key)) { log.push(label + " has " + key); return key === "7"; } return Reflect.has(target, key); },
  };
}
function look(label, object) {
  const before = log.length;
  const read = [object[0], object[1], object[5]];
  object[6] = "stored";
  const line = [label, JSON.stringify(read), Object.hasOwn(object, 6), 7 in object, 8 in object, log.slice(before).join("|")].join(" ; ");
  console.log(line);
}

{
  class Shelf { constructor() { this[0] = "a"; this[1] = "b"; } }
  const early = new Shelf();
  look("instance, nothing above", early);
  const second = new Shelf();
  Object.setPrototypeOf(Shelf.prototype, new Proxy({}, traps("instance")));
  look("instance made before", second);
  look("instance made behind", new Shelf());
}
{
  class Holder {}
  Holder.prototype[0] = "on the prototype";
  Holder.prototype[1] = "too";
  new Holder();
  Object.setPrototypeOf(Holder.prototype, new Proxy({}, traps("prototype object")));
  look("the prototype object itself", Holder.prototype);
}
{
  class List extends Array {}
  const list = List.from(["x", "y"]);
  const doubles = List.from([1.5, 2.5]);
  const integers = List.from([1, 2]);
  Object.setPrototypeOf(List.prototype, new Proxy(Array.prototype, traps("list")));
  look("below Array", list);
  look("below Array, doubles", doubles);
  look("below Array, integers", integers);
  console.log(list.length, doubles.length, integers.length);
  look("below Array, made behind", List.from(["p", "q"]));
}
{
  const parent = { name: "parent" };
  const child = Object.create(parent);
  child[0] = "c0"; child[1] = "c1";
  Object.setPrototypeOf(parent, new Proxy({}, traps("created")));
  look("Object.create", child);
  const later = Object.create(parent);
  later[0] = "l0"; later[1] = "l1";
  look("Object.create, made behind", later);
}
{
  function Target() {}
  const made = Reflect.construct(Array, ["r0", "r1"], Target);
  Object.setPrototypeOf(Target.prototype, new Proxy(Array.prototype, traps("constructed")));
  look("Reflect.construct", made);
  look("Reflect.construct, made behind", Reflect.construct(Array, ["s0", "s1"], Target));
}
{
  class Row { constructor() { this[0] = "r"; this[1] = "s"; } }
  const row = new Row();
  Object.defineProperty(Row.prototype, "6", { set(value) { log.push("the setter under 6 got " + value); }, get() { return "the getter under 6"; }, configurable: true });
  const before = log.length;
  row[6] = "stored";
  console.log("an accessor under an index", Object.hasOwn(row, 6), row[6], log.slice(before).join("|"));
}
{
  class Base {}
  class Middle extends Base {}
  class Leaf extends Middle { constructor() { super(); this[0] = "leaf"; this[1] = "leaf too"; } }
  const leaf = new Leaf();
  Object.setPrototypeOf(Base.prototype, new Proxy({}, traps("two classes up")));
  look("two classes up", leaf);
}
{
  const plain = ["stays", "fast"];
  const literal = { 0: "stays", 1: "plain" };
  look("an ordinary array", plain);
  look("an ordinary object", literal);
}
