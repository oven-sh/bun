import * as namespaceSource from "./spread-copies-slow-paths.js";

export const exportedNumber = 7;
export function exportedFunction() {
  return 8;
}

const log = [];
const describe = value => (typeof value === "function" ? "function" : typeof value === "symbol" ? String(value) : JSON.stringify(value));
const show = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const { value, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(object, key);
      return String(key) + "=" + describe(value) + (writable && enumerable && configurable ? "" : "!");
    })
    .join(",");

const forms = {
  copy: s => ({ ...s }),
  extended: s => ({ ...s, a: 1, b: 2 }),
  wide: s => ({ ...s, a: 1, b: 2, c: 3, d: 4 }),
  first: s => ({ a: 1, ...s }),
};

class Holder {
  f = function () {
    return 1;
  };
  n = 2;
  method() {
    return 3;
  }
}

function manyProperties() {
  const object = {};
  for (let i = 0; i < 70; i++) object["key" + i] = i;
  return object;
}

function loggingProxy() {
  const target = { x: 1, y: 2 };
  return new Proxy(target, {
    ownKeys(object) {
      log.push("ownKeys");
      return Reflect.ownKeys(object);
    },
    getOwnPropertyDescriptor(object, key) {
      log.push("getOwnPropertyDescriptor " + String(key));
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
    get(object, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(object, key, receiver);
    },
  });
}

const sources = {
  plain: () => ({ x: 1, y: 2 }),
  "70 properties": manyProperties,
  "index keys": () => ({ 2: "two", x: 1, 0: "zero" }),
  "symbol keys": () => ({ x: 1, [Symbol.for("spread")]: 2 }),
  getter: () => ({
    x: 1,
    get y() {
      log.push("getter y");
      return 2;
    },
  }),
  "non-enumerable": () => Object.defineProperty({ x: 1 }, "hidden", { value: 2, enumerable: false }),
  proxy: loggingProxy,
  "module namespace": () => namespaceSource,
  string: () => "xy",
  number: () => 5,
  null: () => null,
  undefined: () => undefined,
  "class instance": () => new Holder(),
};

for (const [sourceName, createSource] of Object.entries(sources)) {
  for (const [formName, form] of Object.entries(forms)) {
    for (let round = 0; round < 3; round++) {
      const copy = form(createSource());
      console.log(sourceName, formName, round, show(copy), log.splice(0).join(";"));
    }
  }
}

const holder = new Holder();
for (const form of Object.values(forms)) {
  const copy = form(holder);
  console.log("field function is shared", copy.f === holder.f, "method copied", "method" in copy, Object.getPrototypeOf(copy) === Object.prototype);
}

for (let round = 0; round < 3; round++) {
  const existing = { z: 0, a: 9, y: 1 };
  console.log("existing key extended", show({ ...existing, a: 1, b: 2 }));
  console.log("existing key wide", show({ ...existing, a: 1, b: 2, c: 3, d: 4 }));
  console.log("existing key first", show({ a: 1, ...existing }));
  console.log("existing key frozen source", show({ ...Object.freeze({ z: 0, a: 9 }), a: 1 }));

  const ownProto = JSON.parse('{"__proto__":5,"x":1}');
  for (const form of Object.values(forms)) {
    const copy = form(ownProto);
    console.log("own __proto__", show(copy), Object.getPrototypeOf(copy) === Object.prototype);
  }
}
