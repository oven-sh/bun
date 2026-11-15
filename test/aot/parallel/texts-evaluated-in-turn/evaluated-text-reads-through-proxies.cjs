// Text made at run time, spreads and JSON read through proxies whose handlers and targets are objects of the program. What a trap answers is held against the target as it is behind the trap.
const read = new Function("o", "return o.a");
const readIndex = new Function("o", "return o[0]");
const readSymbol = new Function("o", "s", "return o[s]");
const reads = [read, readIndex, o => Reflect.get(o, "a"), o => ({ ...o }).a, o => JSON.stringify(o)];
const has = new Function("o", "return 'a' in o");
const out = [];
const attempt = f => {
  try {
    const value = f();
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch (error) {
    return error.constructor.name + (error instanceof TypeError ? "" : ": " + error.message);
  }
};

const makes = {
  fields: () => ({ a: 1, b: 2 }),
  extraAccessor: () => Object.defineProperty({ b: 2 }, "a", { configurable: true, enumerable: true, get: () => 1 }),
  extraValue: () => Object.defineProperty({ b: 2 }, "a", { configurable: true, enumerable: true, writable: false, value: 1 }),
  fixedAccessor: () => Object.defineProperty({ b: 2 }, "a", { configurable: false, enumerable: true, get: () => 1 }),
  fixedSetter: () => Object.defineProperty({ b: 2 }, "a", { configurable: false, enumerable: true, set() {} }),
  fixedValue: () => Object.defineProperty({ b: 2 }, "a", { configurable: false, enumerable: true, writable: false, value: 1 }),
  fixedWritable: () => Object.defineProperty({ b: 2 }, "a", { configurable: false, enumerable: true, writable: true, value: 1 }),
  fixedField: () => Object.defineProperty({ a: 1, b: 2 }, "a", { configurable: false, writable: false }),
  fixedBeside: () => Object.defineProperty({ a: 1 }, "b", { configurable: false, enumerable: false, writable: false, value: 3 }),
  fixedSymbol: () => Object.defineProperty({ a: 1 }, Symbol.iterator, { configurable: false, enumerable: false, writable: false, value: 3 }),
  fixedElement: () => Object.defineProperty({ a: 1 }, 0, { configurable: false, enumerable: true, writable: false, value: 3 }),
  element: () => Object.defineProperty({ a: 1 }, 0, { configurable: true, enumerable: true, writable: true, value: 3 }),
  elements: () => ({ a: 1, 0: 3, 1: 4 }),
  sealed: () => Object.seal({ a: 1, b: 2 }),
  sealedElements: () => Object.seal({ a: 1, 0: 3 }),
  sealedExtra: () => Object.seal(Object.defineProperty({ b: 2 }, "a", { configurable: true, enumerable: true, get: () => 1 })),
  frozen: () => Object.freeze({ a: 1, b: 2 }),
  frozenElements: () => Object.freeze({ a: 1, 0: 3 }),
  frozenExtra: () => Object.freeze(Object.defineProperty({ b: 2 }, "a", { configurable: true, enumerable: true, value: 1 })),
  closed: () => Object.preventExtensions({ b: 2 }),
  closedExtra: () => Object.preventExtensions(Object.defineProperty({ b: 2 }, "c", { configurable: true, enumerable: true, value: 1 })),
  removed: () => {
    const o = Object.defineProperty({ a: 1, b: 2 }, "c", { configurable: true, get: () => 1 });
    delete o.a;
    return o;
  },
  late: () => {
    const o = { b: 2 };
    for (const key of ["x", "y", "a"]) o[key] = key.length;
    return o;
  },
  nothing: () => Object.create(null, { a: { configurable: true, enumerable: true, get: () => 1 } }),
  list: () => Object.defineProperty([3, 4], "a", { configurable: true, enumerable: true, get: () => 1 }),
  fixedList: () => Object.defineProperty([3, 4], "a", { configurable: false, enumerable: true, writable: false, value: 1 }),
  instance: () => new (class { a = 1; #p = 2; get q() { return this.#p; } })(),
};
const handlers = {
  same: { get: (target, key) => Reflect.get(target, key) },
  other: { get: () => 7, has: () => false },
  none: { get: () => undefined, has: () => true },
  empty: {},
  freezes: {
    get(target, key) {
      const value = target[key];
      Object.freeze(target);
      return typeof value === "number" ? value + 1 : value;
    },
  },
  fixes: {
    get(target, key) {
      if (key === "a") Object.defineProperty(target, "a", { configurable: false, enumerable: true, writable: false, value: 9 });
      return 8;
    },
    has(target, key) {
      if (key === "a") Object.defineProperty(target, "a", { configurable: false, enumerable: true, writable: false, value: 9 });
      return false;
    },
  },
  throws: {
    get() {
      throw new RangeError("from the trap");
    },
  },
  ofClass: new (class {
    get(target, key, receiver) {
      return [typeof key, String(key), receiver === current, this === handlers.ofClass].join();
    }
  })(),
};
let current;
for (const [made, make] of Object.entries(makes)) {
  for (const [name, handler] of Object.entries(handlers)) {
    const line = [];
    for (const how of [...reads, has, o => readSymbol(o, Symbol.iterator)]) {
      for (let turn = 0; turn < 3; turn++) {
        let proxy;
        const result = attempt(() => {
          proxy = current = new Proxy(make(), handler);
          how(proxy);
          return how(proxy);
        });
        if (!turn) line.push(result);
        else if (line.at(-1) !== result) line.push("then " + result);
      }
    }
    out.push(made + " " + name + ": " + line.join(" | "));
  }
}
// One proxy, read by one text while its target, its handler and the trap change.
const target = { b: 2 };
Object.defineProperty(target, "c", { configurable: true, get: () => 3 });
const handler = { get: (t, key) => key + t.b };
const { proxy, revoke } = Proxy.revocable(target, handler);
const steps = [
  () => {},
  () => (target.b = 5),
  () => (handler.get = () => "replaced"),
  () => Object.defineProperty(target, "a", { configurable: false, enumerable: true, writable: false, value: "fixed" }),
  () => (handler.get = () => "fixed"),
  () => delete handler.get,
  () => (handler.get = 3),
  () => (handler.get = null),
  () => Object.defineProperty(handler, "get", { configurable: true, get: () => () => "fixed" }),
  () => Object.defineProperty(handler, "get", { configurable: true, value: (t, key, receiver) => (receiver === proxy ? "fixed" : "other") }),
  () => Object.preventExtensions(target),
  () => revoke(),
];
for (const step of steps) {
  attempt(step);
  out.push([attempt(() => read(proxy)), attempt(() => read(proxy)), attempt(() => has(proxy))].join(" , "));
}
// A proxy above an object, and proxies of proxies.
const above = Object.create(new Proxy({ a: 1 }, { get: (t, key, receiver) => key + (receiver === above) }));
out.push(read(above), read(new Proxy(new Proxy(Object.freeze({ a: 4 }), {}), { get: t => t.a })), attempt(() => read(new Proxy(new Proxy(Object.freeze({ a: 4 }), {}), { get: t => t.a + 1 }))));
// The stack of a trap that throws.
const lines = attempt(() => read(new Proxy({}, { get() { throw new Error("thrown"); } })));
out.push(lines);
console.log(out.join("\n"));
