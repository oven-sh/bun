// Plain properties are defined by descriptors that are written out.
const log = [];
function attempt(label, run) {
  let line;
  try {
    line = run();
  } catch (error) {
    line = "throws " + error.constructor.name;
  }
  log.push(label + ": " + line);
}
function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => {
      const d = Object.getOwnPropertyDescriptor(object, key);
      const flags = (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
      return String(key) + "=" + ("value" in d ? String(d.value) : "accessor") + ":" + flags;
    })
    .join(" ");
}

class Fields {
  constructor(a) {
    Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: a });
    Object.defineProperty(this, "y", { enumerable: true, configurable: true, writable: true, value: a + 1 });
  }
}
attempt("fields", () => describe(new Fields(1)) + " | " + JSON.stringify(new Fields(2)));

const seen = [];
class AboveWithSetter {
  set x(value) {
    seen.push("setter " + value);
  }
  get x() {
    return "from the getter";
  }
}
class BelowSetter extends AboveWithSetter {
  constructor() {
    super();
    Object.defineProperty(this, "x", { value: 5, writable: true, enumerable: true, configurable: true });
  }
}
attempt("a setter above is not called", () => describe(new BelowSetter()) + " " + new BelowSetter().x + " [" + seen.join() + "]");

class Closed {
  constructor(how) {
    this.a = 1;
    how(this);
    Object.defineProperty(this, "b", { value: 2, writable: true, enumerable: true, configurable: true });
  }
}
attempt("not extensible", () => describe(new Closed(Object.preventExtensions)));
attempt("sealed", () => describe(new Closed(Object.seal)));
attempt("frozen", () => describe(new Closed(Object.freeze)));
attempt("left open", () => describe(new Closed(() => {})));

class Again {
  constructor(first) {
    Object.defineProperty(this, "a", first);
    Object.defineProperty(this, "a", { value: "again", writable: true, enumerable: true, configurable: true });
  }
}
attempt("over one that may not change", () => describe(new Again({ value: 1 })));
attempt("over one that is read only", () => describe(new Again({ value: 1, configurable: true })));
attempt("over an accessor", () => describe(new Again({ get() { return 1; }, configurable: true })));
attempt("over an accessor that may not change", () => describe(new Again({ get() { return 1; } })));
attempt("over a plain one", () => describe(new Again({ value: 1, writable: true, enumerable: true, configurable: true })));

function order() {
  const steps = [];
  const made = { first: 1 };
  const result = Object.defineProperty(
    (steps.push("object"), made),
    (steps.push("key"), "second"),
    { value: (steps.push("value"), 2), writable: (steps.push("writable"), true), enumerable: true, configurable: true },
  );
  return steps.join() + " " + (result === made) + " " + describe(made);
}
attempt("order and result", order);

function onLiterals(i) {
  const made = { a: i, b: i + 1 };
  Object.defineProperty(made, "c", { value: i + 2, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(made, "a", { value: "new", writable: true, enumerable: true, configurable: true });
  delete made.b;
  Object.defineProperty(made, "b", { value: "back", writable: true, enumerable: true, configurable: true });
  return describe(made) + " " + Object.keys(made).join();
}
for (let i = 0; i < 3; i++) attempt("literals " + i, () => onLiterals(i));

function otherDescriptors() {
  const made = {};
  Object.defineProperty(made, "hidden", { value: 1, writable: true, enumerable: false, configurable: true });
  Object.defineProperty(made, "fixed", { value: 2, writable: false, enumerable: true, configurable: true });
  Object.defineProperty(made, "kept", { value: 3, writable: true, enumerable: true, configurable: false });
  Object.defineProperty(made, "short", { value: 4 });
  Object.defineProperty(made, "empty", { writable: true, enumerable: true, configurable: true });
  Object.defineProperty(made, "nothing", { value: undefined, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(made, "truthy", { value: 5, writable: 1, enumerable: "yes", configurable: {} });
  return describe(made);
}
attempt("other descriptors", otherDescriptors);

function otherKeys() {
  const made = {};
  const symbol = Symbol("s");
  Object.defineProperty(made, "__proto__", { value: 1, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(made, "0", { value: 2, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(made, 1, { value: 3, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(made, symbol, { value: 4, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(made, "constructor", { value: 5, writable: true, enumerable: true, configurable: true });
  return describe(made) + " " + (Object.getPrototypeOf(made) === Object.prototype);
}
attempt("other keys", otherKeys);

function descriptorThatIsSeenElsewhere() {
  const made = {};
  const descriptor = { value: 1, writable: true, enumerable: true, configurable: true };
  descriptor.writable = false;
  Object.defineProperty(made, "a", descriptor);
  const shared = { value: 2, writable: true, enumerable: true, configurable: true };
  Object.defineProperty(made, "b", shared);
  shared.value = 3;
  Object.defineProperty(made, "c", shared);
  return describe(made);
}
attempt("a descriptor that is seen elsewhere", descriptorThatIsSeenElsewhere);

function otherReceivers() {
  const lines = [];
  const trapped = [];
  const proxy = new Proxy({}, {
    defineProperty(target, key, descriptor) {
      trapped.push(String(key) + " " + Object.keys(descriptor).sort().join());
      return Reflect.defineProperty(target, key, descriptor);
    },
  });
  Object.defineProperty(proxy, "p", { value: 1, writable: true, enumerable: true, configurable: true });
  lines.push(trapped.join("|"));
  const list = [1, 2, 3];
  attempt("the length of a list", () => describe(Object.defineProperty(list, "length", { value: 1, writable: true, enumerable: true, configurable: true })));
  function f() {}
  Object.defineProperty(f, "name", { value: "renamed", writable: true, enumerable: true, configurable: true });
  lines.push(f.name + " " + Object.keys(f).join());
  for (const primitive of [1, "text", null, undefined, true]) {
    attempt("on " + String(primitive), () => String(Object.defineProperty(primitive, "a", { value: 1, writable: true, enumerable: true, configurable: true })));
  }
  return lines.join(" ; ");
}
attempt("other receivers", otherReceivers);

class Counted {
  constructor(i) {
    Object.defineProperty(this, "n", { value: i, writable: true, enumerable: true, configurable: true });
    Object.defineProperty(this, "label", { value: "c" + i, writable: true, enumerable: true, configurable: true });
  }
  total() {
    return this.n + this.label.length;
  }
}
let total = 0;
for (let i = 0; i < 2000; i++) {
  const counted = new Counted(i);
  counted.n += 1;
  total += counted.total();
}
log.push("counted: " + total);

console.log(log.join("\n"));
