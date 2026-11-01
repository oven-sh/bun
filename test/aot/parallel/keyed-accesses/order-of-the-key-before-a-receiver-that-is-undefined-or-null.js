// The language's order: a store to undefined or null throws before its key is converted. Plain Bun converts first, so these hold to their last comment.
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

/* Output:
undefined convertible store key evaluated,value evaluated,TypeError
undefined convertible read key evaluated,TypeError
undefined convertible call key evaluated,TypeError
undefined convertible delete key evaluated,TypeError
undefined convertible plus key evaluated,TypeError
undefined convertible or key evaluated,TypeError
undefined convertible and key evaluated,TypeError
undefined convertible nullish key evaluated,TypeError
undefined convertible increment key evaluated,TypeError
undefined convertible decrement key evaluated,TypeError
undefined convertible in key evaluated,TypeError
undefined convertible optional answer undefined
undefined convertible optional call answer undefined
undefined convertible destructure from TypeError
undefined convertible destructure into value evaluated,key evaluated,TypeError
undefined convertible destructure object into value evaluated,key evaluated,TypeError
undefined convertible for of into value evaluated,key evaluated,TypeError
undefined convertible for in into key evaluated,TypeError
undefined convertible own property key evaluated,key converted,TypeError
undefined convertible reflect key evaluated,TypeError
undefined symbolLike store key evaluated,value evaluated,TypeError
undefined symbolLike read key evaluated,TypeError
undefined symbolLike call key evaluated,TypeError
undefined symbolLike delete key evaluated,TypeError
undefined symbolLike plus key evaluated,TypeError
undefined symbolLike or key evaluated,TypeError
undefined symbolLike and key evaluated,TypeError
undefined symbolLike nullish key evaluated,TypeError
undefined symbolLike increment key evaluated,TypeError
undefined symbolLike decrement key evaluated,TypeError
undefined symbolLike in key evaluated,TypeError
undefined symbolLike optional answer undefined
undefined symbolLike optional call answer undefined
undefined symbolLike destructure from TypeError
undefined symbolLike destructure into value evaluated,key evaluated,TypeError
undefined symbolLike destructure object into value evaluated,key evaluated,TypeError
undefined symbolLike for of into value evaluated,key evaluated,TypeError
undefined symbolLike for in into key evaluated,TypeError
undefined symbolLike own property key evaluated,key to primitive,TypeError
undefined symbolLike reflect key evaluated,TypeError
undefined throwing store key evaluated,value evaluated,TypeError
undefined throwing read key evaluated,TypeError
undefined throwing call key evaluated,TypeError
undefined throwing delete key evaluated,TypeError
undefined throwing plus key evaluated,TypeError
undefined throwing or key evaluated,TypeError
undefined throwing and key evaluated,TypeError
undefined throwing nullish key evaluated,TypeError
undefined throwing increment key evaluated,TypeError
undefined throwing decrement key evaluated,TypeError
undefined throwing in key evaluated,TypeError
undefined throwing optional answer undefined
undefined throwing optional call answer undefined
undefined throwing destructure from TypeError
undefined throwing destructure into value evaluated,key evaluated,TypeError
undefined throwing destructure object into value evaluated,key evaluated,TypeError
undefined throwing for of into value evaluated,key evaluated,TypeError
undefined throwing for in into key evaluated,TypeError
undefined throwing own property key evaluated,key throws,RangeError,from the key
undefined throwing reflect key evaluated,TypeError
undefined text store key evaluated,value evaluated,TypeError
undefined text read key evaluated,TypeError
undefined text call key evaluated,TypeError
undefined text delete key evaluated,TypeError
undefined text plus key evaluated,TypeError
undefined text or key evaluated,TypeError
undefined text and key evaluated,TypeError
undefined text nullish key evaluated,TypeError
undefined text increment key evaluated,TypeError
undefined text decrement key evaluated,TypeError
undefined text in key evaluated,TypeError
undefined text optional answer undefined
undefined text optional call answer undefined
undefined text destructure from TypeError
undefined text destructure into value evaluated,key evaluated,TypeError
undefined text destructure object into value evaluated,key evaluated,TypeError
undefined text for of into value evaluated,key evaluated,TypeError
undefined text for in into key evaluated,TypeError
undefined text own property key evaluated,TypeError
undefined text reflect key evaluated,TypeError
undefined number store key evaluated,value evaluated,TypeError
undefined number read key evaluated,TypeError
undefined number call key evaluated,TypeError
undefined number delete key evaluated,TypeError
undefined number plus key evaluated,TypeError
undefined number or key evaluated,TypeError
undefined number and key evaluated,TypeError
undefined number nullish key evaluated,TypeError
undefined number increment key evaluated,TypeError
undefined number decrement key evaluated,TypeError
undefined number in key evaluated,TypeError
undefined number optional answer undefined
undefined number optional call answer undefined
undefined number destructure from TypeError
undefined number destructure into value evaluated,key evaluated,TypeError
undefined number destructure object into value evaluated,key evaluated,TypeError
undefined number for of into value evaluated,key evaluated,TypeError
undefined number for in into key evaluated,TypeError
undefined number own property key evaluated,TypeError
undefined number reflect key evaluated,TypeError
undefined symbol store key evaluated,value evaluated,TypeError
undefined symbol read key evaluated,TypeError
undefined symbol call key evaluated,TypeError
undefined symbol delete key evaluated,TypeError
undefined symbol plus key evaluated,TypeError
undefined symbol or key evaluated,TypeError
undefined symbol and key evaluated,TypeError
undefined symbol nullish key evaluated,TypeError
undefined symbol increment key evaluated,TypeError
undefined symbol decrement key evaluated,TypeError
undefined symbol in key evaluated,TypeError
undefined symbol optional answer undefined
undefined symbol optional call answer undefined
undefined symbol destructure from TypeError
undefined symbol destructure into value evaluated,key evaluated,TypeError
undefined symbol destructure object into value evaluated,key evaluated,TypeError
undefined symbol for of into value evaluated,key evaluated,TypeError
undefined symbol for in into key evaluated,TypeError
undefined symbol own property key evaluated,TypeError
undefined symbol reflect key evaluated,TypeError
null convertible store key evaluated,value evaluated,TypeError
null convertible read key evaluated,TypeError
null convertible call key evaluated,TypeError
null convertible delete key evaluated,TypeError
null convertible plus key evaluated,TypeError
null convertible or key evaluated,TypeError
null convertible and key evaluated,TypeError
null convertible nullish key evaluated,TypeError
null convertible increment key evaluated,TypeError
null convertible decrement key evaluated,TypeError
null convertible in key evaluated,TypeError
null convertible optional answer undefined
null convertible optional call answer undefined
null convertible destructure from TypeError
null convertible destructure into value evaluated,key evaluated,TypeError
null convertible destructure object into value evaluated,key evaluated,TypeError
null convertible for of into value evaluated,key evaluated,TypeError
null convertible for in into key evaluated,TypeError
null convertible own property key evaluated,key converted,TypeError
null convertible reflect key evaluated,TypeError
null symbolLike store key evaluated,value evaluated,TypeError
null symbolLike read key evaluated,TypeError
null symbolLike call key evaluated,TypeError
null symbolLike delete key evaluated,TypeError
null symbolLike plus key evaluated,TypeError
null symbolLike or key evaluated,TypeError
null symbolLike and key evaluated,TypeError
null symbolLike nullish key evaluated,TypeError
null symbolLike increment key evaluated,TypeError
null symbolLike decrement key evaluated,TypeError
null symbolLike in key evaluated,TypeError
null symbolLike optional answer undefined
null symbolLike optional call answer undefined
null symbolLike destructure from TypeError
null symbolLike destructure into value evaluated,key evaluated,TypeError
null symbolLike destructure object into value evaluated,key evaluated,TypeError
null symbolLike for of into value evaluated,key evaluated,TypeError
null symbolLike for in into key evaluated,TypeError
null symbolLike own property key evaluated,key to primitive,TypeError
null symbolLike reflect key evaluated,TypeError
null throwing store key evaluated,value evaluated,TypeError
null throwing read key evaluated,TypeError
null throwing call key evaluated,TypeError
null throwing delete key evaluated,TypeError
null throwing plus key evaluated,TypeError
null throwing or key evaluated,TypeError
null throwing and key evaluated,TypeError
null throwing nullish key evaluated,TypeError
null throwing increment key evaluated,TypeError
null throwing decrement key evaluated,TypeError
null throwing in key evaluated,TypeError
null throwing optional answer undefined
null throwing optional call answer undefined
null throwing destructure from TypeError
null throwing destructure into value evaluated,key evaluated,TypeError
null throwing destructure object into value evaluated,key evaluated,TypeError
null throwing for of into value evaluated,key evaluated,TypeError
null throwing for in into key evaluated,TypeError
null throwing own property key evaluated,key throws,RangeError,from the key
null throwing reflect key evaluated,TypeError
null text store key evaluated,value evaluated,TypeError
null text read key evaluated,TypeError
null text call key evaluated,TypeError
null text delete key evaluated,TypeError
null text plus key evaluated,TypeError
null text or key evaluated,TypeError
null text and key evaluated,TypeError
null text nullish key evaluated,TypeError
null text increment key evaluated,TypeError
null text decrement key evaluated,TypeError
null text in key evaluated,TypeError
null text optional answer undefined
null text optional call answer undefined
null text destructure from TypeError
null text destructure into value evaluated,key evaluated,TypeError
null text destructure object into value evaluated,key evaluated,TypeError
null text for of into value evaluated,key evaluated,TypeError
null text for in into key evaluated,TypeError
null text own property key evaluated,TypeError
null text reflect key evaluated,TypeError
null number store key evaluated,value evaluated,TypeError
null number read key evaluated,TypeError
null number call key evaluated,TypeError
null number delete key evaluated,TypeError
null number plus key evaluated,TypeError
null number or key evaluated,TypeError
null number and key evaluated,TypeError
null number nullish key evaluated,TypeError
null number increment key evaluated,TypeError
null number decrement key evaluated,TypeError
null number in key evaluated,TypeError
null number optional answer undefined
null number optional call answer undefined
null number destructure from TypeError
null number destructure into value evaluated,key evaluated,TypeError
null number destructure object into value evaluated,key evaluated,TypeError
null number for of into value evaluated,key evaluated,TypeError
null number for in into key evaluated,TypeError
null number own property key evaluated,TypeError
null number reflect key evaluated,TypeError
null symbol store key evaluated,value evaluated,TypeError
null symbol read key evaluated,TypeError
null symbol call key evaluated,TypeError
null symbol delete key evaluated,TypeError
null symbol plus key evaluated,TypeError
null symbol or key evaluated,TypeError
null symbol and key evaluated,TypeError
null symbol nullish key evaluated,TypeError
null symbol increment key evaluated,TypeError
null symbol decrement key evaluated,TypeError
null symbol in key evaluated,TypeError
null symbol optional answer undefined
null symbol optional call answer undefined
null symbol destructure from TypeError
null symbol destructure into value evaluated,key evaluated,TypeError
null symbol destructure object into value evaluated,key evaluated,TypeError
null symbol for of into value evaluated,key evaluated,TypeError
null symbol for in into key evaluated,TypeError
null symbol own property key evaluated,TypeError
null symbol reflect key evaluated,TypeError
written undefined store key evaluated,value evaluated,TypeError
written null store key evaluated,value evaluated,TypeError
written undefined read key evaluated,TypeError
written null read key evaluated,TypeError
written undefined delete key evaluated,TypeError
written null delete key evaluated,TypeError
written undefined plus key evaluated,TypeError
written null plus key evaluated,TypeError
hot store, then undefined key evaluated,value evaluated,TypeError
hot store, then null key evaluated,value evaluated,TypeError
hot store, a number key evaluated,value evaluated,TypeError
hot read, then undefined TypeError
hot read, then null TypeError
hot delete, then undefined TypeError
either true store key evaluated,value evaluated,key converted,answer 1
either true read key evaluated,key converted,answer undefined
either true delete key evaluated,key converted,answer true
either true plus key evaluated,key converted,value evaluated,answer NaN
either false store key evaluated,value evaluated,TypeError
either false read key evaluated,TypeError
either false delete key evaluated,TypeError
either false plus key evaluated,TypeError
either true store key evaluated,value evaluated,key converted,answer 1
either true read key evaluated,key converted,answer undefined
either true delete key evaluated,key converted,answer true
either true plus key evaluated,key converted,value evaluated,answer NaN
either false store key evaluated,value evaluated,TypeError
either false read key evaluated,TypeError
either false delete key evaluated,TypeError
either false plus key evaluated,TypeError
number store key evaluated,value evaluated,key converted,TypeError
number read key evaluated,key converted,answer undefined
number delete key evaluated,key converted,answer true
text store key evaluated,value evaluated,key converted,TypeError
text read key evaluated,key converted,answer t
text delete key evaluated,key converted,TypeError
true store key evaluated,value evaluated,key converted,TypeError
true read key evaluated,key converted,answer undefined
true delete key evaluated,key converted,answer true
symbol store key evaluated,value evaluated,key converted,TypeError
symbol read key evaluated,key converted,answer undefined
symbol delete key evaluated,key converted,answer true
bigint store key evaluated,value evaluated,key converted,TypeError
bigint read key evaluated,key converted,answer undefined
bigint delete key evaluated,key converted,answer true
*/
