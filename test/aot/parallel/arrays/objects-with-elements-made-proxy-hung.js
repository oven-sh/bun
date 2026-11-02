// Objects that hold elements, made before and behind the moment at which a proxy, an accessor under an index or a typed array comes to stand above them: a hole is read from above, and a store to a hole asks above.
const seen = [];
const handler = {
  get(target, key, receiver) {
    return typeof key === "string" && /^\d+$/.test(key) ? "above:" + key : Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    seen.push(String(key));
    return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true });
  },
};
const show = (label, object) => {
  seen.length = 0;
  object[7] = "stored";
  console.log(label, String(object[1]), String(object[7]), seen.join());
};
{
  class List extends Array {}
  const before = List.from([1, , 3]);
  Object.setPrototypeOf(List.prototype, new Proxy(Array.prototype, handler));
  show("an array of a derived class made before", before);
  show("one made behind", List.from([1, , 3]));
  show("one constructed behind", new List(3));
}
{
  function Made() {
    this[0] = 1;
    this[2] = 3;
  }
  const before = new Made();
  Object.setPrototypeOf(Made.prototype, new Proxy({}, handler));
  show("an instance of a function made before", before);
  show("one made behind", new Made());
}
{
  const above = {};
  const middle = Object.create(above);
  const before = Object.create(middle);
  before[0] = 1;
  before[2] = 3;
  Object.setPrototypeOf(above, new Proxy({}, handler));
  show("two levels below, made before", before);
  const behind = Object.create(middle);
  behind[0] = 1;
  behind[2] = 3;
  show("two levels below, made behind", behind);
}
{
  class Base {}
  class Holder extends Base {
    constructor() {
      super();
      this[0] = 1;
      this[2] = 3;
    }
  }
  const before = new Holder();
  Object.setPrototypeOf(Base.prototype, new Proxy({}, handler));
  show("an instance of a class below, made before", before);
  show("one made behind", new Holder());
}
{
  const above = {};
  const before = Object.setPrototypeOf([1, , 3], above);
  Object.defineProperty(above, "1", { get: () => "getter", set: () => seen.push("setter"), configurable: true });
  seen.length = 0;
  before[1] = "stored";
  console.log("an accessor under an index above an array", String(before[1]), seen.join());
}
{
  const bytes = new Uint8Array(2);
  const before = Object.setPrototypeOf([1, , 3], bytes);
  const other = {};
  Object.setPrototypeOf(Object.create(other), null);
  Object.setPrototypeOf(other, new Proxy({}, handler));
  before[7] = "stored";
  console.log("an array below a typed array", String(before[1]), String(before[7]), before.length);
}
{
  const made = [];
  for (let i = 0; i < 300; i++) {
    class Leaf {
      constructor() {
        this[0] = i;
        this[2] = i;
      }
    }
    const before = new Leaf();
    Object.setPrototypeOf(Leaf.prototype, new Proxy({}, handler));
    made.push(String(before[1]), String(new Leaf()[1]));
    if (i % 100 === 99) Bun.gc(true);
  }
  console.log("classes made again and again", new Set(made).size, made.length);
}
{
  const vm = require("node:vm");
  const context = vm.createContext({});
  const before = vm.runInContext("[1, , 3]", context);
  const OtherArray = vm.runInContext("Array", context);
  let changed = true;
  try {
    Object.setPrototypeOf(OtherArray.prototype, new Proxy(Object.getPrototypeOf(OtherArray.prototype), handler));
  } catch {
    changed = false;
  }
  if (changed && Object.getPrototypeOf(OtherArray.prototype) !== vm.runInContext("Object.prototype", context))
    show("an array of another realm", before);
  else console.log("the other realm keeps its chain");
}
