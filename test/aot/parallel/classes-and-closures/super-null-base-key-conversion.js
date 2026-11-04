// With a null super base, a keyed read throws before the key is converted to a property key, and a keyed store converts the key first.
let log = [];

const key = {
  toString() {
    log.push("key converted");
    return "x";
  },
};
const throwingKey = {
  toString() {
    log.push("key throws");
    throw new RangeError("from the key");
  },
};

function value() {
  log.push("value evaluated");
  return 1;
}

function attempt(label, action) {
  log = [];
  try {
    log.push(`returned a ${typeof action()}`);
  } catch (error) {
    log.push(error.name);
  }
  console.log(`${label}: ${log.join(", ")}`);
}

function createLiteral(parent) {
  return {
    __proto__: parent,
    read(k) {
      return super[k];
    },
    call(k) {
      return super[k]();
    },
    store(k) {
      return (super[k] = value());
    },
    add(k) {
      return (super[k] += value());
    },
    increment(k) {
      return super[k]++;
    },
  };
}

function createClass(parent) {
  class Derived {
    read(k) {
      return super[k];
    }
    store(k) {
      return (super[k] = value());
    }
    static read(k) {
      return super[k];
    }
    static store(k) {
      return (super[k] = value());
    }
  }
  Object.setPrototypeOf(Derived.prototype, parent);
  Object.setPrototypeOf(Derived, parent);
  return Derived;
}

const objectParent = {
  x() {
    return "called";
  },
  0: "element",
  [Symbol.iterator]: "symbol",
};

const keys = [
  ["object key", key],
  ["throwing key", throwingKey],
  ["string key", "x"],
  ["index key", 0],
  ["symbol key", Symbol.iterator],
];

for (const [parentLabel, base] of [
  ["null parent", null],
  ["object parent", objectParent],
]) {
  for (const [keyLabel, k] of keys) {
    console.log(`== ${parentLabel}, ${keyLabel}`);
    attempt("literal read", () => createLiteral(base).read(k));
    attempt("literal call", () => createLiteral(base).call(k));
    attempt("literal store", () => createLiteral(base).store(k));
    attempt("literal add", () => createLiteral(base).add(k));
    attempt("literal increment", () => createLiteral(base).increment(k));
    attempt("method read", () => new (createClass(base))().read(k));
    attempt("method store", () => new (createClass(base))().store(k));
    attempt("static read", () => createClass(base).read(k));
    attempt("static store", () => createClass(base).store(k));
  }
}
