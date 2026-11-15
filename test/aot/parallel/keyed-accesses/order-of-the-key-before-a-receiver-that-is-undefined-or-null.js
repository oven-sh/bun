// A store to undefined or null converts its key before it throws, as in plain Bun.
// target[key] on undefined or null: whether the key is converted before the TypeError, in every form of access, by each way that the receiver and the key can be known.
let order = [];
const convertible = {
  toString() {
    order.push("key converted");
    return "0";
  },
};
const symbolLike = {
  [Symbol.toPrimitive]() {
    order.push("key to primitive");
    return "name";
  },
};
const throwing = {
  toString() {
    order.push("key throws");
    throw new RangeError("from the key");
  },
};
const keyValues = { convertible, symbolLike, throwing, text: "name", number: 0, symbol: Symbol.iterator };
const value = () => {
  order.push("value evaluated");
  return 1;
};
function report(label, run) {
  order = [];
  try {
    const answer = run();
    order.push(`answer ${String(answer)}`);
  } catch (error) {
    order.push(error.name);
    // The error of the key's own toString, by its text.
    if (error instanceof RangeError) order.push(error.message);
  }
  console.log(label, order.join());
}
const forms = {
  store: (target, key) => (target[key()] = value()),
  read: (target, key) => target[key()],
  call: (target, key) => target[key()](value()),
  delete: (target, key) => delete target[key()],
  plus: (target, key) => (target[key()] += value()),
  or: (target, key) => (target[key()] ||= value()),
  and: (target, key) => (target[key()] &&= value()),
  nullish: (target, key) => (target[key()] ??= value()),
  increment: (target, key) => target[key()]++,
  decrement: (target, key) => --target[key()],
  in: (target, key) => key() in target,
  optional: (target, key) => target?.[key()],
  "optional call": (target, key) => target?.[key()]?.(),
  "destructure from": (target, key) => {
    const { [key()]: found } = target;
    return found;
  },
  "destructure into": (target, key) => {
    [target[key()]] = [value()];
  },
  "destructure object into": (target, key) => {
    ({ a: target[key()] } = { a: value() });
  },
  "for of into": (target, key) => {
    for (target[key()] of [value()]);
  },
  "for in into": (target, key) => {
    for (target[key()] in { a: 1 });
  },
  "own property": (target, key) => Object.prototype.hasOwnProperty.call(target, key()),
  reflect: (target, key) => Reflect.get(target, key()),
};
for (const [targetName, target] of [
  ["undefined", undefined],
  ["null", null],
]) {
  for (const [keyName, keyValue] of Object.entries(keyValues)) {
    const key = () => {
      order.push("key evaluated");
      return keyValue;
    };
    for (const [formName, form] of Object.entries(forms))
      report(`${targetName} ${keyName} ${formName}`, () => form(target, key));
  }
}

// The same where the compiler sees what the receiver is, and where a loop has made the path hot.
function key() {
  order.push("key evaluated");
  return convertible;
}
function written() {
  report("written undefined store", () => (undefined[key()] = value()));
  report("written null store", () => (null[key()] = value()));
  report("written undefined read", () => undefined[key()]);
  report("written null read", () => null[key()]);
  report("written undefined delete", () => delete undefined[key()]);
  report("written null delete", () => delete null[key()]);
  report("written undefined plus", () => (undefined[key()] += value()));
  report("written null plus", () => (null[key()] += value()));
}
written();
function storeTo(target, keyValue) {
  order.push("key evaluated");
  target[keyValue] = value();
  return "stored";
}
const objectTarget = {};
const listTarget = [1, 2];
for (let i = 0; i < 40; i++) {
  storeTo(objectTarget, "a" + (i & 3));
  storeTo(listTarget, i & 1);
  storeTo(objectTarget, convertible);
}
report("hot store, then undefined", () => storeTo(undefined, convertible));
report("hot store, then null", () => storeTo(null, convertible));
report("hot store, a number", () => storeTo(undefined, 1));
function readOf(target, keyValue) {
  return target[keyValue];
}
for (let i = 0; i < 40; i++) {
  readOf(objectTarget, "a0");
  readOf(listTarget, 0);
  readOf(objectTarget, convertible);
}
report("hot read, then undefined", () => readOf(undefined, convertible));
report("hot read, then null", () => readOf(null, convertible));
function deleteOf(target, keyValue) {
  return delete target[keyValue];
}
for (let i = 0; i < 40; i++) deleteOf({ a: 1 }, "a");
report("hot delete, then undefined", () => deleteOf(undefined, convertible));

// A receiver that may be nothing beside one that is an object, and a key of each kind in one site.
function either(isThere) {
  return isThere ? { field: 1 } : undefined;
}
for (const isThere of [true, false, true, false]) {
  report(`either ${isThere} store`, () => (either(isThere)[key()] = value()));
  report(`either ${isThere} read`, () => either(isThere)[key()]);
  report(`either ${isThere} delete`, () => delete either(isThere)[key()]);
  report(`either ${isThere} plus`, () => (either(isThere)[key()] += value()));
}
// A receiver of a primitive: no TypeError, and the key is converted.
for (const [name, target] of [
  ["number", 1],
  ["text", "text"],
  ["true", true],
  ["symbol", Symbol.iterator],
  ["bigint", 1n],
]) {
  report(`${name} store`, () => (target[key()] = value()));
  report(`${name} read`, () => target[key()]);
  report(`${name} delete`, () => delete target[key()]);
}
// 285 lines.
