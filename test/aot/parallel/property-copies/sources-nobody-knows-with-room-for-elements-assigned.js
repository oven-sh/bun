// Object.assign onto an empty literal, in a function that does not know what it copies. Sources hold a symbol in front of a name and have, or once had, room for elements.
// Bun.inspect lists names and symbols in the order in which they were stored.
const local = Symbol("local");
const other = Symbol("other");
const hide = (object, key) =>
  Object.defineProperty(object, key, { value: "hidden", enumerable: false, writable: true, configurable: true });
const sources = {
  "a hidden element"() {
    const made = { [local]: 0 };
    hide(made, 0);
    made.a = "v";
    return made;
  },
  "a hidden element far off"() {
    const made = { [local]: 0 };
    hide(made, 100000);
    made.a = "v";
    return made;
  },
  "an element stored and deleted"() {
    const made = { [local]: 0 };
    made[0] = 1;
    delete made[0];
    made.a = "v";
    return made;
  },
  "names and symbols by turns"() {
    const made = { a: 1, [local]: 2, b: 3, [other]: 4, c: 5 };
    hide(made, 0);
    return made;
  },
  "a hidden symbol too"() {
    const made = { [local]: 0 };
    hide(made, other);
    hide(made, 0);
    made.a = "v";
    return made;
  },
  "an element that is copied"() {
    const made = { [local]: 0 };
    made[3] = "three";
    made.a = "v";
    return made;
  },
  "an instance"() {
    const made = new (class {
      [local] = 0;
    })();
    hide(made, 0);
    made.a = "v";
    return made;
  },
  "a parsed object"() {
    const made = JSON.parse('{"p":1}');
    made[local] = 0;
    hide(made, 0);
    made.a = "v";
    return made;
  },
  "no room for elements"() {
    const made = { [local]: 0 };
    made.a = "v";
    return made;
  },
  "an empty list"() {
    const made = [];
    made[local] = 0;
    made.a = "v";
    return made;
  },
};
function assigned(source) {
  return Object.assign({}, source);
}
function assignedWithMore(source) {
  return Object.assign({}, source, { last: 1 });
}
function spread(source) {
  return { ...source };
}
const text = value => Bun.inspect(value).replace(/\s+/g, " ");
for (const name in sources) {
  console.log(name, "|", text(assigned(sources[name]())), "|", text(assignedWithMore(sources[name]())), "|", text(spread(sources[name]())));
  console.log(name, "|", Reflect.ownKeys(assigned(sources[name]())), "|", text(assigned(assigned(sources[name]()))));
}
