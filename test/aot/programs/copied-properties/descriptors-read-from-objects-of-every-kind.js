// Object.defineProperty, Object.defineProperties and Object.create read six names of a descriptor, own or inherited, through getters where there are getters.
// The descriptors here are literals, instances, copies, frozen objects and objects under other prototypes.
const lines = [];
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));

const describe = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return "absent";
  const flags = ("writable" in descriptor ? (descriptor.writable ? "w" : "-") : "a") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
  return flags + " " + ("value" in descriptor ? String(descriptor.value) : typeof descriptor.get + "/" + typeof descriptor.set);
};

function attempt(name, descriptor) {
  try {
    lines.push(name + ": " + describe(Object.defineProperty({}, "x", descriptor), "x"));
  } catch (error) {
    lines.push(name + ": " + error.name + ": " + error.message);
  }
  try {
    lines.push(name + " in a map: " + describe(Object.defineProperties({}, { x: descriptor }), "x") + " | " + describe(Object.create(null, { x: descriptor }), "x"));
  } catch (error) {
    lines.push(name + " in a map: " + error.name);
  }
}

class Flags {
  constructor(value) {
    this.value = value;
  }
  get enumerable() {
    lines.push("inherited getter ran");
    return true;
  }
}

let reads = 0;
const getter = () => 7;
const setter = value => void value;
function all() {
  attempt("empty", {});
  attempt("value", { value: 1 });
  attempt("every flag", { value: 2, writable: true, enumerable: true, configurable: true });
  attempt("flags that are not booleans", { value: 3, writable: 1, enumerable: "", configurable: {} });
  attempt("undefined flags", { value: undefined, writable: undefined, enumerable: undefined });
  attempt("getter", { get: getter, enumerable: true });
  attempt("getter and setter", { get: getter, set: setter, configurable: true });
  attempt("undefined getter", { get: undefined });
  attempt("getter that cannot be called", { get: 1 });
  attempt("setter that cannot be called", { set: "text" });
  attempt("value beside a getter", { value: 1, get: getter });
  attempt("writable beside a setter", { writable: true, set: setter });
  attempt("other names beside", { other: 1, value: 4, more: 2, [Symbol("tag")]: 3, 0: "index" });
  attempt("names in another order", { configurable: true, enumerable: true, writable: true, value: 5 });
  attempt("a getter for the value", {
    get value() {
      reads++;
      return "read " + reads;
    },
    enumerable: true,
  });
  attempt("hidden name", Object.defineProperty({ value: 6 }, "enumerable", { value: true, enumerable: false }));
  attempt("frozen", Object.freeze({ value: 7, enumerable: true }));
  attempt("name added later", Object.assign({ value: 8 }, { enumerable: true }));
  attempt("name deleted", (() => { const d = { value: 9, enumerable: true }; delete d.enumerable; return d; })());
  attempt("copy", { ...unknown({ value: 10, enumerable: true }) });
  attempt("passed through unknown code", unknown({ value: 11, configurable: true }));
  attempt("instance", new Flags(12));
  attempt("under a prototype", Object.setPrototypeOf({ value: 13 }, { enumerable: true, writable: true }));
  attempt("created under a prototype", Object.create({ value: 14, enumerable: true }));
  attempt("without a prototype", Object.assign(Object.create(null), { value: 15, enumerable: true }));
  attempt("a descriptor that was asked for", Object.getOwnPropertyDescriptor({ a: 16 }, "a"));
  attempt("a descriptor of an accessor", Object.getOwnPropertyDescriptor({ get a() { return 17; } }, "a"));
  attempt("function", Object.assign(() => {}, { value: 18 }));
  attempt("array", Object.assign([], { value: 19 }));
  for (const primitive of [undefined, null, 1, "text", true, Symbol.iterator]) attempt("primitive " + String(primitive), primitive);
}

all();

let sum = 0;
for (let turn = 0; turn < 20000; turn++) {
  const holder = Object.defineProperty({}, "x", { enumerable: true, get: () => turn });
  sum += holder.x + Object.keys(holder).length;
}
lines.push(String(sum));
console.log(lines.join("\n"));
