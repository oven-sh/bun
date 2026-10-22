// Array patterns over an iterator that logs every step, with a default of every kind: literals, functions, locals, `this`, containers and built-in constants, and defaults that run code, which keep their place between the steps.
const log = [];
const note = (text) => {
  log.push(text);
  return text;
};

function steps(values, onNext = () => {}) {
  let index = 0;
  return {
    [Symbol.iterator]() {
      note("open");
      return this;
    },
    next() {
      note("next " + index);
      onNext();
      return index < values.length ? { value: values[index++], done: false } : { value: undefined, done: true };
    },
    return() {
      note("return");
      return {};
    },
  };
}

function show(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function run(label, body) {
  let result;
  try {
    result = body().map(show).join(" ");
  } catch (error) {
    result = "threw " + error.name;
  }
  console.log(label + ": " + result + " | " + log.join(", "));
  log.length = 0;
}

function literals(x) {
  const [a = 1, b = "two", c = null, d = true, e = 5n] = x;
  return [a, b, c, d, e];
}

function functions(x) {
  const [arrow = () => 1, plain = function () {}, named = function inner() {}] = x;
  return [arrow, plain, named];
}

function locals(x, fallback) {
  const [a = fallback, b = a] = x;
  return [a, b];
}

function assigned(x, fallback) {
  let a = "old a";
  let b = "old b";
  [a = b, b = a, a = fallback] = x;
  return [a, b];
}

function containers(x, fallback) {
  const [list = [fallback, 1, , 2], record = { fallback: fallback, nested: { list: [] } }] = x;
  return [list, record];
}

function receiver(x) {
  const [self = this] = x;
  return [self === this];
}

function operators(x, fallback) {
  const [a = !fallback, b = typeof fallback, c = void 0, d = -1] = x;
  return [a, b, c, d];
}

function constants(x) {
  const [a = undefined, b = NaN, c = Infinity, d = Math.PI, e = Math.floor] = x;
  return [a, b, c, d, e];
}

function calls(x) {
  const [a = note("default a"), b = note("default b")] = x;
  return [a, b];
}

const source = {
  get first() {
    return note("get first");
  },
  get second() {
    return note("get second");
  },
};
function getters(x) {
  const [a = source.first, b = source.second] = x;
  return [a, b];
}

const convertible = {
  toString() {
    return note("toString");
  },
  valueOf() {
    note("valueOf");
    return 7;
  },
  *[Symbol.iterator]() {
    note("spread");
    yield 1;
  },
  get own() {
    return note("get own");
  },
};
function conversions(x) {
  const [a = `${convertible}`, b = -convertible, c = [...convertible], d = { ...convertible }] = x;
  return [a, b, c, Object.keys(d)];
}

function classes(x) {
  const [anonymous = class {}, named = class Inner {}, computed = class { [note("class key")]() {} }] = x;
  return [anonymous, named, computed];
}

function throwing(x) {
  const [a, b = note("default b"), c = (() => { throw new RangeError("default c"); })(), d = note("default d")] = x;
  return [a, b, c, d];
}

function deadZone(x) {
  const [a = b, b] = x;
  return [a, b];
}

function captured(values) {
  let count = 0;
  const [a = count, b = count, c = count] = steps(values, () => count++);
  return [a, b, c];
}

let shared = 0;
function moduleVariable(values) {
  shared = 0;
  const [a = shared, b = shared, c = shared] = steps(values, () => shared++);
  return [a, b, c];
}

globalThis.sharedGlobal = 0;
function globalVariable(values) {
  globalThis.sharedGlobal = 0;
  const [a = sharedGlobal, b = sharedGlobal, c = sharedGlobal] = steps(values, () => globalThis.sharedGlobal++);
  return [a, b, c];
}

class Base {
  constructor(x) {
    const [self = this] = x;
    this.same = self === this;
  }
}

class Derived extends Base {
  constructor(x) {
    try {
      const [self = this] = x;
      note("read " + typeof self);
    } catch (error) {
      note(error.name);
    }
    super(steps([]));
  }
}

for (const values of [[], [undefined, undefined, undefined, undefined], [0, null], ["v", "w", "x", "y", "z", "more"]]) {
  console.log("-- " + show(values.map(String)));
  run("literals", () => literals(steps(values)));
  run("functions", () => functions(steps(values)));
  run("locals", () => locals(steps(values), "fallback"));
  run("assigned", () => assigned(steps(values), "fallback"));
  run("containers", () => containers(steps(values), "fallback"));
  run("receiver", () => receiver.call({}, steps(values)));
  run("operators", () => operators(steps(values), "fallback"));
  run("constants", () => constants(steps(values)));
  run("calls", () => calls(steps(values)));
  run("getters", () => getters(steps(values)));
  run("conversions", () => conversions(steps(values)));
  run("classes", () => classes(steps(values)));
  run("throwing", () => throwing(steps(values)));
  run("dead zone", () => deadZone(steps(values)));
  run("captured", () => captured(values));
  run("module variable", () => moduleVariable(values));
  run("global variable", () => globalVariable(values));
  run("base constructor", () => [new Base(steps(values)).same]);
  run("derived constructor", () => [new Derived(steps(values)).same]);
}
