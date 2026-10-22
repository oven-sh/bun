// Whatever is done to a copy stays with the copy, and whatever is done to the source afterwards stays with the source: stores, stores of another kind of value, new names, deletes,
// redefinitions, freezing, another prototype. Copies of copies behave alike. The sources have passed through text that is evaluated at run time.
const lines = [];
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));
const show = object =>
  Reflect.ownKeys(object)
    .map(key => String(key) + "=" + String(object[key]))
    .join(",");

function copy(source) {
  return { ...source };
}
function replace(source, value) {
  return { ...source, a: value };
}
function make(a, b, c) {
  return { a, b, c };
}

const changes = {
  store(object) {
    object.b = 20;
  },
  storeOtherKind(object) {
    object.a = "text";
    object.b = 1.5;
    object.c = { nested: true };
  },
  addName(object) {
    object.added = 1;
    object.alsoAdded = 2;
  },
  addIndex(object) {
    object[0] = "zero";
  },
  addSymbol(object) {
    object[Symbol.for("added")] = 1;
  },
  deleteFirst(object) {
    delete object.a;
  },
  deleteAll(object) {
    delete object.a;
    delete object.b;
    delete object.c;
  },
  deleteAndAddBack(object) {
    delete object.b;
    object.b = "back";
  },
  defineGetter(object) {
    Object.defineProperty(object, "b", { get: () => "got", enumerable: true, configurable: true });
  },
  hide(object) {
    Object.defineProperty(object, "b", { enumerable: false });
  },
  freeze(object) {
    Object.freeze(object);
  },
  seal(object) {
    Object.seal(object);
  },
  otherPrototype(object) {
    Object.setPrototypeOf(object, { inherited: 1 });
  },
  becomePrototype(object) {
    lines.push("heir reads " + Object.create(object).c);
  },
  assign(object) {
    Object.assign(object, { c: 30, d: 40 });
  },
};

for (const [name, change] of Object.entries(changes)) {
  const source = unknown(make(1, 2, 3));
  const first = copy(source);
  const second = replace(source, 10);
  const third = copy(first);
  change(first);
  lines.push(name + " on a copy: " + [source, first, second, third].map(show).join(" | "));
  lines.push(name + " copied again: " + show(copy(unknown(first))) + " | " + show(replace(unknown(first), 11)));

  const other = unknown(make(4, 5, 6));
  const before = copy(other);
  change(other);
  const after = copy(other);
  lines.push(name + " on the source: " + [other, before, after].map(show).join(" | "));
  lines.push(name + " states: " + [first, before, after].map(object => [Object.isFrozen(object), Object.isExtensible(object), Object.getPrototypeOf(object) === Object.prototype].join()).join(" | "));
}

// The functions an object holds are the same functions in its copy.
const withFunctions = unknown({
  a: 1,
  method() {
    return this.a;
  },
  arrow: () => 2,
  plain: function () {
    return 3;
  },
});
const copied = copy(withFunctions);
lines.push([copied.method === withFunctions.method, copied.arrow === withFunctions.arrow, copied.plain === withFunctions.plain, replace(withFunctions, 7).method()].join());

// Many turns, so that the collector runs while copies are made and dropped.
let chain = unknown(make(0, "kept", [1, 2, 3]));
let total = 0;
const kept = [];
for (let turn = 1; turn <= 200000; turn++) {
  chain = replace(chain, turn);
  if (turn % 20000 === 0) kept.push(chain);
  total += chain.a + chain.c.length;
}
lines.push(total + " " + kept.map(show).join(" | "));

console.log(lines.join("\n"));
