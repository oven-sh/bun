function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const log = [];

function key(name) {
  return {
    toString() {
      log.push("key " + name);
      return name;
    },
  };
}

function value(name) {
  log.push("value " + name);
  return name;
}

function report(label, run) {
  attempt(label, run);
  console.log("  order:", log.splice(0).join(", "));
}

const parent = {
  a: "parent a",
  get own() {
    return "getter sees " + this.name;
  },
  set stored(given) {
    log.push("setter gets " + given + " for " + this.name);
  },
  method(argument) {
    return "parent method of " + this.name + " with " + argument;
  },
  count: 1,
  1: "parent one",
  [Symbol.for("s")]: "parent symbol",
};

function makeChild(prototype) {
  return {
    __proto__: prototype,
    name: "child",
    a: "child a",
    read(k) {
      return super[k];
    },
    store(k, v) {
      super[k] = v;
      return Object.keys(this).join(",");
    },
    storeEvaluated(k) {
      super[k] = value("v");
      return Object.keys(this).join(",");
    },
    call(k) {
      return super[k](value("argument"));
    },
    add(k) {
      super[k] += 1;
      return [this[k], Object.hasOwn(this, String(k))];
    },
    increment(k) {
      return [super[k]++, this.count];
    },
    remove(k) {
      return delete super[k];
    },
    assignIfMissing(k) {
      super[k] ??= value("default");
      return this[k];
    },
  };
}

for (let i = 0; i < 2000; i++) {
  const child = makeChild(parent);
  child.read("a");
  child.store("b", 1);
  child.call("method");
  child.add("count");
}
log.length = 0;

const keys = [
  ["'a'", () => "a"],
  ["'a' put together", () => "" + make("'a'")],
  ["an object for 'a'", () => key("a")],
  ["'own'", () => "own"],
  ["an object for 'own'", () => key("own")],
  ["'missing'", () => "missing"],
  ["1", () => 1],
  ["'1'", () => "1"],
  ["a symbol", () => Symbol.for("s")],
  ["null", () => null],
  ["'__proto__'", () => "__proto__"],
  ["'constructor'", () => "constructor"],
];

for (const [label, makeKey] of keys) {
  report("read " + label, () => {
    const found = makeChild(parent).read(makeKey());
    return typeof found === "function" ? "function " + found.name : found === Object.prototype ? "Object.prototype" : found;
  });
  report("store " + label, () => makeChild(parent).store(makeKey(), "stored"));
}

report("store through a setter", () => makeChild(parent).store(key("stored"), "given"));
report("store: key and value", () => makeChild(parent).storeEvaluated(key("b")));
report("call", () => makeChild(parent).call(key("method")));
report("call of a missing member", () => makeChild(parent).call(key("missing")));
report("add", () => makeChild(parent).add(key("count")));
report("increment", () => makeChild(parent).increment(key("count")));
report("delete", () => makeChild(parent).remove(key("a")));
report("assign if missing", () => makeChild(parent).assignIfMissing(key("absent")));
report("assign if present", () => makeChild(parent).assignIfMissing(key("a")));

report("no parent: read", () => makeChild(null).read(key("a")));
report("no parent: store", () => makeChild(null).store(key("a"), 1));
report("no parent: store, key and value", () => makeChild(null).storeEvaluated(key("a")));
report("no parent: call", () => makeChild(null).call(key("a")));
report("no parent: add", () => makeChild(null).add(key("a")));
report("no parent: delete", () => makeChild(null).remove(key("a")));
report("no parent: assign if missing", () => makeChild(null).assignIfMissing(key("a")));

report("the parent is replaced later", () => {
  const child = makeChild(parent);
  const before = child.read("a");
  Object.setPrototypeOf(child, { a: "another parent" });
  return [before, child.read("a"), child.read(key("a"))];
});
report("the method is borrowed: super stays with its home", () => {
  const child = makeChild(parent);
  const borrowed = { name: "borrower", read: child.read, call: child.call };
  return [borrowed.read("own"), borrowed.call("method")];
});
report("the parent is a Proxy", () => makeChild(new Proxy({}, { get: (target, name, receiver) => (log.push("get " + String(name) + " for " + receiver.name), "trapped") })).read(key("anything")));
report("the parent is a list", () => [makeChild(["zero", "one"]).read(1), makeChild(["zero", "one"]).read("1"), makeChild(["zero", "one"]).read("length"), makeChild(["zero", "one"]).read(key("0"))]);
report("the parent is a wrapped text", () => [makeChild(new String("xy")).read(1), makeChild(new String("xy")).read("length"), makeChild(new String("xy")).read(key("0"))]);
