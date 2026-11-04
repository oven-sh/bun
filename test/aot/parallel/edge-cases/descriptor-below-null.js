// Object.defineProperty with a descriptor that is written out. Below null only its own members count, below an object the inherited ones count too.
export {};

const log = [];
const defaults = {
  enumerable: true,
  get configurable() {
    log.push("configurable is read");
    return true;
  },
};
const mark = Symbol("mark");

function attributes(object, key) {
  const found = Object.getOwnPropertyDescriptor(object, key);
  return [found.enumerable, found.configurable, found.writable, typeof found.get, typeof found.set, String(found.value)].join();
}

function getterBelowNull(target, value) {
  return Object.defineProperty(target, "a", { __proto__: null, enumerable: true, get: () => value });
}

function prototypeWrittenLast(target, value) {
  return Object.defineProperty(target, "b", { value, writable: true, __proto__: null });
}

function nothingBelowNull(target) {
  return Object.defineProperty(target, "c", { __proto__: null });
}

function belowObject(target, above) {
  return Object.defineProperty(target, "d", { __proto__: above, value: "d" });
}

function belowEither(target, key, flag, above) {
  return Object.defineProperty(target, key, { __proto__: flag ? null : above, value: key });
}

function belowValueThatIsIgnored(target) {
  return Object.defineProperty(target, "g", { __proto__: undefined, value: "g", configurable: true });
}

function usedTwice(target) {
  const descriptor = { __proto__: null, enumerable: true, value: "twice" };
  Object.defineProperty(target, "h", descriptor);
  Object.defineProperty(target, "i", descriptor);
  return (Object.getPrototypeOf(descriptor) === null) + " " + Object.keys(descriptor).join("+");
}

function underOtherKeys(target) {
  Object.defineProperty(target, mark, { __proto__: null, value: "symbol", enumerable: true });
  Object.defineProperty(target, 0, { __proto__: null, value: "index", enumerable: true });
  return target[mark] + " " + target[0] + " " + Object.keys(target).join("+");
}

function isRefused(define) {
  try {
    define();
  } catch (error) {
    return error instanceof TypeError;
  }
  return "defined";
}

const target = {};
console.log(getterBelowNull(target, 7) === target, target.a, attributes(target, "a"));
console.log(prototypeWrittenLast(target, 8) === target, target.b, attributes(target, "b"));
console.log(attributes(nothingBelowNull(target), "c"));
console.log(attributes(belowObject(target, defaults), "d"), log.join());
console.log(attributes(belowEither(target, "e", true, defaults), "e"), log.length);
console.log(attributes(belowEither(target, "f", false, defaults), "f"), log.length);
console.log(attributes(belowValueThatIsIgnored(target), "g"));
console.log(usedTwice(target), attributes(target, "h"), attributes(target, "i"));
console.log(underOtherKeys({}));
console.log(Object.keys(target).join());

console.log(isRefused(() => Object.defineProperty({}, "j", { __proto__: null, get: 1 })));
console.log(isRefused(() => Object.defineProperty({}, "k", { __proto__: null, get: () => 1, value: 1 })));
console.log(isRefused(() => Object.defineProperty(Object.freeze({}), "l", { __proto__: null, value: 1 })));
console.log(isRefused(() => Object.defineProperty(1, "m", { __proto__: null, value: 1 })));
console.log(isRefused(() => Object.defineProperty({}, "n", { __proto__: null, get: undefined })));
