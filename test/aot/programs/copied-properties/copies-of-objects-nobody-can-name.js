// `{ ...source }`, `{ ...source, name: value }` and the rest of a pattern, where the source has passed through text that is evaluated at run time, so that nothing is known about it.
// The copy has the enumerable own properties of the source in their order, it is a plain extensible object, and what happens to it afterwards does not reach the source.
const lines = [];
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));
const tag = Symbol("tag");
const hidden = Symbol("hidden");

const describe = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
      return String(key) + "=" + String(descriptor.value) + ":" + flags;
    })
    .join(",");

const state = object =>
  describe(object) +
  " | " +
  [Object.getPrototypeOf(object) === Object.prototype, Object.isExtensible(object), Object.isFrozen(object), Object.isSealed(object)].join();

function copy(source) {
  return { ...source };
}
function replace(source, value) {
  return { ...source, a: value };
}
function add(source, value) {
  return { ...source, added: value };
}
function without({ a, ...others }) {
  return others;
}
function withoutComputed(source, key) {
  const { [key]: taken, ...others } = source;
  return [taken, others];
}

class Point {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
  get sum() {
    return this.a + this.b;
  }
}
function Pair(a, b) {
  this.a = a;
  this.b = b;
}
Pair.prototype.inherited = "never copied";

let getterRuns = 0;
const sources = {
  literal: { a: 1, b: 2, c: 3 },
  otherOrder: { c: 3, a: 1, b: 2 },
  filledLater: (() => {
    const object = { b: 2 };
    object.c = 3;
    object.a = 1;
    return object;
  })(),
  deleted: (() => {
    const object = { a: 1, b: 2, c: 3 };
    delete object.b;
    return object;
  })(),
  deletedAndBack: (() => {
    const object = { a: 1, b: 2, c: 3 };
    delete object.a;
    object.a = 4;
    return object;
  })(),
  getter: {
    a: 1,
    get b() {
      getterRuns++;
      return "from getter " + getterRuns;
    },
    c: 3,
  },
  redefined: Object.defineProperty({ a: 1, b: 2, c: 3 }, "b", { get: () => "redefined", enumerable: true, configurable: true }),
  nonEnumerable: Object.defineProperty({ a: 1, b: 2, c: 3 }, "b", { enumerable: false }),
  readOnly: Object.defineProperty({ a: 1, b: 2, c: 3 }, "a", { writable: false }),
  symbols: { a: 1, [tag]: "tagged", b: 2 },
  hiddenSymbol: Object.defineProperty({ a: 1 }, hidden, { value: "hidden", enumerable: false }),
  numericNames: { b: 1, 2: "two", a: 2, 1: "one", "-1": "minus" },
  ownProto: JSON.parse('{"a":1,"__proto__":{"polluted":true},"b":2}'),
  frozen: Object.freeze({ a: 1, b: 2, c: 3 }),
  sealed: Object.seal({ a: 1, b: 2 }),
  notExtensible: Object.preventExtensions({ a: 1, b: 2 }),
  otherPrototype: Object.setPrototypeOf({ a: 1, b: 2 }, { inherited: "never copied" }),
  noPrototype: Object.assign(Object.create(null), { a: 1, b: 2 }),
  instance: new Point(1, 2),
  constructed: new Pair(1, 2),
  parsed: JSON.parse('{"a":1,"b":[2],"c":{"d":3}}'),
  array: ["x", "y"],
  sparse: [, "y", , "w"],
  string: "hi",
  stringObject: Object.assign(new String("hi"), { a: 1 }),
  number: 5,
  yes: true,
  no: false,
  nothing: null,
  missing: undefined,
  symbol: tag,
  bigint: 10n,
  func: Object.assign(function named() {}, { a: 1 }),
  map: Object.assign(new Map([[1, 2]]), { a: 1 }),
  holdsUndefined: { a: undefined, b: null, c: NaN, d: -0 },
  doubles: { a: 1.5, b: 2 ** 40, c: -0, d: 1e300 },
  mixed: { a: "text", b: { nested: true }, c: [1], d: () => 1, e: 1n, f: tag },
  wide: Object.fromEntries(Array.from({ length: 40 }, (_, index) => ["k" + index, index])),
  empty: {},
};

for (const [name, source] of Object.entries(sources)) {
  const value = unknown(source);
  lines.push(name + " copy: " + state(copy(value)));
  lines.push(name + " replace: " + state(replace(value, "replaced")));
  lines.push(name + " add: " + state(add(value, "added")));
  if (value !== null && value !== undefined) {
    lines.push(name + " without: " + state(without(value)));
    const [taken, others] = withoutComputed(value, unknown("b"));
    lines.push(name + " without computed: " + String(taken) + " " + state(others));
  }
}
lines.push("getter runs: " + getterRuns);

const proxyLog = [];
const proxy = new Proxy(
  { a: 1, b: 2, c: 3 },
  {
    ownKeys(target) {
      proxyLog.push("ownKeys");
      return ["c", "a", "b"];
    },
    getOwnPropertyDescriptor(target, key) {
      proxyLog.push("describe " + String(key));
      return key === "a" ? { value: 1, enumerable: false, configurable: true } : Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key) {
      proxyLog.push("get " + String(key));
      return target[key] * 10;
    },
  },
);
lines.push("proxy copy: " + state(copy(unknown(proxy))));
lines.push("proxy without: " + state(without(unknown(proxy))));
lines.push(proxyLog.join());

for (const thrower of [
  {
    a: 1,
    get b() {
      throw new RangeError("thrown by a getter");
    },
  },
  new Proxy({}, { ownKeys: () => { throw new RangeError("thrown by a trap"); } }),
]) {
  for (const run of [copy, replace, add, without]) {
    try {
      run(unknown(thrower), 1);
      lines.push("no error");
    } catch (error) {
      lines.push(run.name + ": " + error.name + ": " + error.message);
    }
  }
}
for (const nullish of [null, undefined]) {
  try {
    without(unknown(nullish));
    lines.push("no error");
  } catch (error) {
    lines.push(error.name);
  }
}

console.log(lines.join("\n"));
