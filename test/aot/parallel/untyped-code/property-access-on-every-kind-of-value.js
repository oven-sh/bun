// Messages for a nullish base and for `in` on a primitive differ between `bun run` and compiled code, so those print the error's name. A nullish base is refused before the key is converted, as ECMAScript says; plain Bun converts the key first.
function show(value) {
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object" && value !== null) return "object";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function attempt(label, action, printsMessage) {
  try {
    console.log(`${label}: ${show(action())}`);
  } catch (error) {
    console.log(`${label}: ${error.name}${printsMessage ? `: ${error.message}` : ""}`);
  }
}

class Point {
  x = 1;
  get doubled() {
    return this.x * 2;
  }
}

function loggingProxy() {
  const log = (trap, key) => console.log(`  trap ${trap} ${show(key)}`);
  return new Proxy(
    { x: 1 },
    {
      get(target, key, receiver) {
        log("get", key);
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        log("set", key);
        return Reflect.set(target, key, value, receiver);
      },
      has(target, key) {
        log("has", key);
        return Reflect.has(target, key);
      },
      deleteProperty(target, key) {
        log("deleteProperty", key);
        return Reflect.deleteProperty(target, key);
      },
      getOwnPropertyDescriptor(target, key) {
        log("getOwnPropertyDescriptor", key);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      defineProperty(target, key, descriptor) {
        log("defineProperty", key);
        return Reflect.defineProperty(target, key, descriptor);
      },
    },
  );
}

const kinds = [
  ["undefined", () => undefined],
  ["null", () => null],
  ["integer", () => 7],
  ["double", () => 1.5],
  ["string", () => "text"],
  ["boolean", () => true],
  ["array", () => [10, 20]],
  ["plain object", () => ({ x: 1, 0: "zero" })],
  ["class instance", () => new Point()],
  ["frozen object", () => Object.freeze({ x: 1, 0: "zero" })],
  ["proxy", loggingProxy],
];

const symbol = Symbol("key");
const keys = [
  ["string", () => "x"],
  ["length", () => "length"],
  ["symbol", () => symbol],
  ["zero", () => 0],
  ["negative zero", () => -0],
  ["two to the 32", () => 2 ** 32],
  ["fraction", () => 1.5],
];

function strictSetName(base, value) {
  "use strict";
  base.x = value;
  return base.x;
}

function sloppySetName(base, value) {
  base.x = value;
  return base.x;
}

function strictSetKey(base, key, value) {
  "use strict";
  base[key] = value;
  return base[key];
}

function sloppySetKey(base, key, value) {
  base[key] = value;
  return base[key];
}

function sloppyDeleteName(base) {
  return delete base.x;
}

function strictDeleteName(base) {
  "use strict";
  return delete base.x;
}

function sloppyDeleteKey(base, key) {
  return delete base[key];
}

function strictDeleteKey(base, key) {
  "use strict";
  return delete base[key];
}

for (const [kind, create] of kinds) {
  const isNullish = create() === undefined || create() === null;
  const printsMessage = !isNullish;
  console.log(`== ${kind}`);
  attempt("get x", () => create().x, printsMessage);
  attempt("get length", () => create().length, printsMessage);
  attempt("get absent", () => create().absent, printsMessage);
  attempt("strict set x", () => strictSetName(create(), 2), printsMessage);
  attempt("sloppy set x", () => sloppySetName(create(), 2), printsMessage);
  attempt("has x", () => "x" in create(), false);
  attempt("sloppy delete x", () => sloppyDeleteName(create()), printsMessage);
  attempt("strict delete x", () => strictDeleteName(create()), printsMessage);
  for (const [keyKind, createKey] of keys) {
    attempt(`get [${keyKind}]`, () => create()[createKey()], printsMessage);
    attempt(`strict set [${keyKind}]`, () => strictSetKey(create(), createKey(), 2), printsMessage);
    attempt(`sloppy set [${keyKind}]`, () => sloppySetKey(create(), createKey(), 2), printsMessage);
    attempt(`has [${keyKind}]`, () => createKey() in create(), false);
    attempt(`sloppy delete [${keyKind}]`, () => sloppyDeleteKey(create(), createKey()), printsMessage);
    attempt(`strict delete [${keyKind}]`, () => strictDeleteKey(create(), createKey()), printsMessage);
  }

  let conversions = 0;
  const countingKey = {
    toString() {
      conversions++;
      return "x";
    },
  };
  attempt("get [counting key]", () => create()[countingKey], printsMessage);
  console.log(`  conversions ${conversions}`);
  attempt("strict set [counting key]", () => strictSetKey(create(), countingKey, 2), printsMessage);
  console.log(`  conversions ${conversions}`);
  attempt("has [counting key]", () => countingKey in create(), false);
  console.log(`  conversions ${conversions}`);
  attempt("sloppy delete [counting key]", () => sloppyDeleteKey(create(), countingKey), printsMessage);
  console.log(`  conversions ${conversions}`);
}

function conversionOrder(label, action) {
  const order = [];
  const key = {
    toString() {
      order.push("toString");
      return "x";
    },
  };
  attempt(label, () => action(key), false);
  console.log(`  order [${order}]`);
}

conversionOrder("null[key]", key => null[key]);
conversionOrder("undefined[key]", key => undefined[key]);
conversionOrder("key in null", key => key in null);
conversionOrder("delete null[key]", key => delete null[key]);

const present = { x: "present", 3: "three" };
console.log(present.x, present["x"], present[3], "x" in present, 3 in present);
console.log(delete present.x, delete present[3], "x" in present, 3 in present);

const [first, second, third = "default"] = [1, , undefined];
console.log(first, second, third);
const [fromString, fromStringSecond] = "ab";
console.log(fromString, fromStringSecond);
/* Output:
== undefined
get x: TypeError
get length: TypeError
get absent: TypeError
strict set x: TypeError
sloppy set x: TypeError
has x: TypeError
sloppy delete x: TypeError
strict delete x: TypeError
get [string]: TypeError
strict set [string]: TypeError
sloppy set [string]: TypeError
has [string]: TypeError
sloppy delete [string]: TypeError
strict delete [string]: TypeError
get [length]: TypeError
strict set [length]: TypeError
sloppy set [length]: TypeError
has [length]: TypeError
sloppy delete [length]: TypeError
strict delete [length]: TypeError
get [symbol]: TypeError
strict set [symbol]: TypeError
sloppy set [symbol]: TypeError
has [symbol]: TypeError
sloppy delete [symbol]: TypeError
strict delete [symbol]: TypeError
get [zero]: TypeError
strict set [zero]: TypeError
sloppy set [zero]: TypeError
has [zero]: TypeError
sloppy delete [zero]: TypeError
strict delete [zero]: TypeError
get [negative zero]: TypeError
strict set [negative zero]: TypeError
sloppy set [negative zero]: TypeError
has [negative zero]: TypeError
sloppy delete [negative zero]: TypeError
strict delete [negative zero]: TypeError
get [two to the 32]: TypeError
strict set [two to the 32]: TypeError
sloppy set [two to the 32]: TypeError
has [two to the 32]: TypeError
sloppy delete [two to the 32]: TypeError
strict delete [two to the 32]: TypeError
get [fraction]: TypeError
strict set [fraction]: TypeError
sloppy set [fraction]: TypeError
has [fraction]: TypeError
sloppy delete [fraction]: TypeError
strict delete [fraction]: TypeError
get [counting key]: TypeError
  conversions 0
strict set [counting key]: TypeError
  conversions 0
has [counting key]: TypeError
  conversions 0
sloppy delete [counting key]: TypeError
  conversions 0
== null
get x: TypeError
get length: TypeError
get absent: TypeError
strict set x: TypeError
sloppy set x: TypeError
has x: TypeError
sloppy delete x: TypeError
strict delete x: TypeError
get [string]: TypeError
strict set [string]: TypeError
sloppy set [string]: TypeError
has [string]: TypeError
sloppy delete [string]: TypeError
strict delete [string]: TypeError
get [length]: TypeError
strict set [length]: TypeError
sloppy set [length]: TypeError
has [length]: TypeError
sloppy delete [length]: TypeError
strict delete [length]: TypeError
get [symbol]: TypeError
strict set [symbol]: TypeError
sloppy set [symbol]: TypeError
has [symbol]: TypeError
sloppy delete [symbol]: TypeError
strict delete [symbol]: TypeError
get [zero]: TypeError
strict set [zero]: TypeError
sloppy set [zero]: TypeError
has [zero]: TypeError
sloppy delete [zero]: TypeError
strict delete [zero]: TypeError
get [negative zero]: TypeError
strict set [negative zero]: TypeError
sloppy set [negative zero]: TypeError
has [negative zero]: TypeError
sloppy delete [negative zero]: TypeError
strict delete [negative zero]: TypeError
get [two to the 32]: TypeError
strict set [two to the 32]: TypeError
sloppy set [two to the 32]: TypeError
has [two to the 32]: TypeError
sloppy delete [two to the 32]: TypeError
strict delete [two to the 32]: TypeError
get [fraction]: TypeError
strict set [fraction]: TypeError
sloppy set [fraction]: TypeError
has [fraction]: TypeError
sloppy delete [fraction]: TypeError
strict delete [fraction]: TypeError
get [counting key]: TypeError
  conversions 0
strict set [counting key]: TypeError
  conversions 0
has [counting key]: TypeError
  conversions 0
sloppy delete [counting key]: TypeError
  conversions 0
== integer
get x: undefined
get length: undefined
get absent: undefined
strict set x: TypeError: Attempted to assign to readonly property.
sloppy set x: TypeError: Attempted to assign to readonly property.
has x: TypeError
sloppy delete x: true
strict delete x: true
get [string]: undefined
strict set [string]: TypeError: Attempted to assign to readonly property.
sloppy set [string]: TypeError: Attempted to assign to readonly property.
has [string]: TypeError
sloppy delete [string]: true
strict delete [string]: true
get [length]: undefined
strict set [length]: TypeError: Attempted to assign to readonly property.
sloppy set [length]: TypeError: Attempted to assign to readonly property.
has [length]: TypeError
sloppy delete [length]: true
strict delete [length]: true
get [symbol]: undefined
strict set [symbol]: TypeError: Attempted to assign to readonly property.
sloppy set [symbol]: TypeError: Attempted to assign to readonly property.
has [symbol]: TypeError
sloppy delete [symbol]: true
strict delete [symbol]: true
get [zero]: undefined
strict set [zero]: TypeError: Attempted to assign to readonly property.
sloppy set [zero]: TypeError: Attempted to assign to readonly property.
has [zero]: TypeError
sloppy delete [zero]: true
strict delete [zero]: true
get [negative zero]: undefined
strict set [negative zero]: TypeError: Attempted to assign to readonly property.
sloppy set [negative zero]: TypeError: Attempted to assign to readonly property.
has [negative zero]: TypeError
sloppy delete [negative zero]: true
strict delete [negative zero]: true
get [two to the 32]: undefined
strict set [two to the 32]: TypeError: Attempted to assign to readonly property.
sloppy set [two to the 32]: TypeError: Attempted to assign to readonly property.
has [two to the 32]: TypeError
sloppy delete [two to the 32]: true
strict delete [two to the 32]: true
get [fraction]: undefined
strict set [fraction]: TypeError: Attempted to assign to readonly property.
sloppy set [fraction]: TypeError: Attempted to assign to readonly property.
has [fraction]: TypeError
sloppy delete [fraction]: true
strict delete [fraction]: true
get [counting key]: undefined
  conversions 1
strict set [counting key]: TypeError: Attempted to assign to readonly property.
  conversions 2
has [counting key]: TypeError
  conversions 2
sloppy delete [counting key]: true
  conversions 3
== double
get x: undefined
get length: undefined
get absent: undefined
strict set x: TypeError: Attempted to assign to readonly property.
sloppy set x: TypeError: Attempted to assign to readonly property.
has x: TypeError
sloppy delete x: true
strict delete x: true
get [string]: undefined
strict set [string]: TypeError: Attempted to assign to readonly property.
sloppy set [string]: TypeError: Attempted to assign to readonly property.
has [string]: TypeError
sloppy delete [string]: true
strict delete [string]: true
get [length]: undefined
strict set [length]: TypeError: Attempted to assign to readonly property.
sloppy set [length]: TypeError: Attempted to assign to readonly property.
has [length]: TypeError
sloppy delete [length]: true
strict delete [length]: true
get [symbol]: undefined
strict set [symbol]: TypeError: Attempted to assign to readonly property.
sloppy set [symbol]: TypeError: Attempted to assign to readonly property.
has [symbol]: TypeError
sloppy delete [symbol]: true
strict delete [symbol]: true
get [zero]: undefined
strict set [zero]: TypeError: Attempted to assign to readonly property.
sloppy set [zero]: TypeError: Attempted to assign to readonly property.
has [zero]: TypeError
sloppy delete [zero]: true
strict delete [zero]: true
get [negative zero]: undefined
strict set [negative zero]: TypeError: Attempted to assign to readonly property.
sloppy set [negative zero]: TypeError: Attempted to assign to readonly property.
has [negative zero]: TypeError
sloppy delete [negative zero]: true
strict delete [negative zero]: true
get [two to the 32]: undefined
strict set [two to the 32]: TypeError: Attempted to assign to readonly property.
sloppy set [two to the 32]: TypeError: Attempted to assign to readonly property.
has [two to the 32]: TypeError
sloppy delete [two to the 32]: true
strict delete [two to the 32]: true
get [fraction]: undefined
strict set [fraction]: TypeError: Attempted to assign to readonly property.
sloppy set [fraction]: TypeError: Attempted to assign to readonly property.
has [fraction]: TypeError
sloppy delete [fraction]: true
strict delete [fraction]: true
get [counting key]: undefined
  conversions 1
strict set [counting key]: TypeError: Attempted to assign to readonly property.
  conversions 2
has [counting key]: TypeError
  conversions 2
sloppy delete [counting key]: true
  conversions 3
== string
get x: undefined
get length: 4
get absent: undefined
strict set x: TypeError: Attempted to assign to readonly property.
sloppy set x: TypeError: Attempted to assign to readonly property.
has x: TypeError
sloppy delete x: true
strict delete x: true
get [string]: undefined
strict set [string]: TypeError: Attempted to assign to readonly property.
sloppy set [string]: TypeError: Attempted to assign to readonly property.
has [string]: TypeError
sloppy delete [string]: true
strict delete [string]: true
get [length]: 4
strict set [length]: TypeError: Attempted to assign to readonly property.
sloppy set [length]: TypeError: Attempted to assign to readonly property.
has [length]: TypeError
sloppy delete [length]: TypeError: Unable to delete property.
strict delete [length]: TypeError: Unable to delete property.
get [symbol]: undefined
strict set [symbol]: TypeError: Attempted to assign to readonly property.
sloppy set [symbol]: TypeError: Attempted to assign to readonly property.
has [symbol]: TypeError
sloppy delete [symbol]: true
strict delete [symbol]: true
get [zero]: t
strict set [zero]: TypeError: Attempted to assign to readonly property.
sloppy set [zero]: TypeError: Attempted to assign to readonly property.
has [zero]: TypeError
sloppy delete [zero]: TypeError: Unable to delete property.
strict delete [zero]: TypeError: Unable to delete property.
get [negative zero]: t
strict set [negative zero]: TypeError: Attempted to assign to readonly property.
sloppy set [negative zero]: TypeError: Attempted to assign to readonly property.
has [negative zero]: TypeError
sloppy delete [negative zero]: TypeError: Unable to delete property.
strict delete [negative zero]: TypeError: Unable to delete property.
get [two to the 32]: undefined
strict set [two to the 32]: TypeError: Attempted to assign to readonly property.
sloppy set [two to the 32]: TypeError: Attempted to assign to readonly property.
has [two to the 32]: TypeError
sloppy delete [two to the 32]: true
strict delete [two to the 32]: true
get [fraction]: undefined
strict set [fraction]: TypeError: Attempted to assign to readonly property.
sloppy set [fraction]: TypeError: Attempted to assign to readonly property.
has [fraction]: TypeError
sloppy delete [fraction]: true
strict delete [fraction]: true
get [counting key]: undefined
  conversions 1
strict set [counting key]: TypeError: Attempted to assign to readonly property.
  conversions 2
has [counting key]: TypeError
  conversions 2
sloppy delete [counting key]: true
  conversions 3
== boolean
get x: undefined
get length: undefined
get absent: undefined
strict set x: TypeError: Attempted to assign to readonly property.
sloppy set x: TypeError: Attempted to assign to readonly property.
has x: TypeError
sloppy delete x: true
strict delete x: true
get [string]: undefined
strict set [string]: TypeError: Attempted to assign to readonly property.
sloppy set [string]: TypeError: Attempted to assign to readonly property.
has [string]: TypeError
sloppy delete [string]: true
strict delete [string]: true
get [length]: undefined
strict set [length]: TypeError: Attempted to assign to readonly property.
sloppy set [length]: TypeError: Attempted to assign to readonly property.
has [length]: TypeError
sloppy delete [length]: true
strict delete [length]: true
get [symbol]: undefined
strict set [symbol]: TypeError: Attempted to assign to readonly property.
sloppy set [symbol]: TypeError: Attempted to assign to readonly property.
has [symbol]: TypeError
sloppy delete [symbol]: true
strict delete [symbol]: true
get [zero]: undefined
strict set [zero]: TypeError: Attempted to assign to readonly property.
sloppy set [zero]: TypeError: Attempted to assign to readonly property.
has [zero]: TypeError
sloppy delete [zero]: true
strict delete [zero]: true
get [negative zero]: undefined
strict set [negative zero]: TypeError: Attempted to assign to readonly property.
sloppy set [negative zero]: TypeError: Attempted to assign to readonly property.
has [negative zero]: TypeError
sloppy delete [negative zero]: true
strict delete [negative zero]: true
get [two to the 32]: undefined
strict set [two to the 32]: TypeError: Attempted to assign to readonly property.
sloppy set [two to the 32]: TypeError: Attempted to assign to readonly property.
has [two to the 32]: TypeError
sloppy delete [two to the 32]: true
strict delete [two to the 32]: true
get [fraction]: undefined
strict set [fraction]: TypeError: Attempted to assign to readonly property.
sloppy set [fraction]: TypeError: Attempted to assign to readonly property.
has [fraction]: TypeError
sloppy delete [fraction]: true
strict delete [fraction]: true
get [counting key]: undefined
  conversions 1
strict set [counting key]: TypeError: Attempted to assign to readonly property.
  conversions 2
has [counting key]: TypeError
  conversions 2
sloppy delete [counting key]: true
  conversions 3
== array
get x: undefined
get length: 2
get absent: undefined
strict set x: 2
sloppy set x: 2
has x: false
sloppy delete x: true
strict delete x: true
get [string]: undefined
strict set [string]: 2
sloppy set [string]: 2
has [string]: false
sloppy delete [string]: true
strict delete [string]: true
get [length]: 2
strict set [length]: 2
sloppy set [length]: 2
has [length]: true
sloppy delete [length]: TypeError: Unable to delete property.
strict delete [length]: TypeError: Unable to delete property.
get [symbol]: undefined
strict set [symbol]: 2
sloppy set [symbol]: 2
has [symbol]: false
sloppy delete [symbol]: true
strict delete [symbol]: true
get [zero]: 10
strict set [zero]: 2
sloppy set [zero]: 2
has [zero]: true
sloppy delete [zero]: true
strict delete [zero]: true
get [negative zero]: 10
strict set [negative zero]: 2
sloppy set [negative zero]: 2
has [negative zero]: true
sloppy delete [negative zero]: true
strict delete [negative zero]: true
get [two to the 32]: undefined
strict set [two to the 32]: 2
sloppy set [two to the 32]: 2
has [two to the 32]: false
sloppy delete [two to the 32]: true
strict delete [two to the 32]: true
get [fraction]: undefined
strict set [fraction]: 2
sloppy set [fraction]: 2
has [fraction]: false
sloppy delete [fraction]: true
strict delete [fraction]: true
get [counting key]: undefined
  conversions 1
strict set [counting key]: 2
  conversions 3
has [counting key]: false
  conversions 4
sloppy delete [counting key]: true
  conversions 5
== plain object
get x: 1
get length: undefined
get absent: undefined
strict set x: 2
sloppy set x: 2
has x: true
sloppy delete x: true
strict delete x: true
get [string]: 1
strict set [string]: 2
sloppy set [string]: 2
has [string]: true
sloppy delete [string]: true
strict delete [string]: true
get [length]: undefined
strict set [length]: 2
sloppy set [length]: 2
has [length]: false
sloppy delete [length]: true
strict delete [length]: true
get [symbol]: undefined
strict set [symbol]: 2
sloppy set [symbol]: 2
has [symbol]: false
sloppy delete [symbol]: true
strict delete [symbol]: true
get [zero]: zero
strict set [zero]: 2
sloppy set [zero]: 2
has [zero]: true
sloppy delete [zero]: true
strict delete [zero]: true
get [negative zero]: zero
strict set [negative zero]: 2
sloppy set [negative zero]: 2
has [negative zero]: true
sloppy delete [negative zero]: true
strict delete [negative zero]: true
get [two to the 32]: undefined
strict set [two to the 32]: 2
sloppy set [two to the 32]: 2
has [two to the 32]: false
sloppy delete [two to the 32]: true
strict delete [two to the 32]: true
get [fraction]: undefined
strict set [fraction]: 2
sloppy set [fraction]: 2
has [fraction]: false
sloppy delete [fraction]: true
strict delete [fraction]: true
get [counting key]: 1
  conversions 1
strict set [counting key]: 2
  conversions 3
has [counting key]: true
  conversions 4
sloppy delete [counting key]: true
  conversions 5
== class instance
get x: 1
get length: undefined
get absent: undefined
strict set x: 2
sloppy set x: 2
has x: true
sloppy delete x: true
strict delete x: true
get [string]: 1
strict set [string]: 2
sloppy set [string]: 2
has [string]: true
sloppy delete [string]: true
strict delete [string]: true
get [length]: undefined
strict set [length]: 2
sloppy set [length]: 2
has [length]: false
sloppy delete [length]: true
strict delete [length]: true
get [symbol]: undefined
strict set [symbol]: 2
sloppy set [symbol]: 2
has [symbol]: false
sloppy delete [symbol]: true
strict delete [symbol]: true
get [zero]: undefined
strict set [zero]: 2
sloppy set [zero]: 2
has [zero]: false
sloppy delete [zero]: true
strict delete [zero]: true
get [negative zero]: undefined
strict set [negative zero]: 2
sloppy set [negative zero]: 2
has [negative zero]: false
sloppy delete [negative zero]: true
strict delete [negative zero]: true
get [two to the 32]: undefined
strict set [two to the 32]: 2
sloppy set [two to the 32]: 2
has [two to the 32]: false
sloppy delete [two to the 32]: true
strict delete [two to the 32]: true
get [fraction]: undefined
strict set [fraction]: 2
sloppy set [fraction]: 2
has [fraction]: false
sloppy delete [fraction]: true
strict delete [fraction]: true
get [counting key]: 1
  conversions 1
strict set [counting key]: 2
  conversions 3
has [counting key]: true
  conversions 4
sloppy delete [counting key]: true
  conversions 5
== frozen object
get x: 1
get length: undefined
get absent: undefined
strict set x: TypeError: Attempted to assign to readonly property.
sloppy set x: TypeError: Attempted to assign to readonly property.
has x: true
sloppy delete x: TypeError: Unable to delete property.
strict delete x: TypeError: Unable to delete property.
get [string]: 1
strict set [string]: TypeError: Attempted to assign to readonly property.
sloppy set [string]: TypeError: Attempted to assign to readonly property.
has [string]: true
sloppy delete [string]: TypeError: Unable to delete property.
strict delete [string]: TypeError: Unable to delete property.
get [length]: undefined
strict set [length]: TypeError: Attempting to define property on object that is not extensible.
sloppy set [length]: TypeError: Attempting to define property on object that is not extensible.
has [length]: false
sloppy delete [length]: true
strict delete [length]: true
get [symbol]: undefined
strict set [symbol]: TypeError: Attempting to define property on object that is not extensible.
sloppy set [symbol]: TypeError: Attempting to define property on object that is not extensible.
has [symbol]: false
sloppy delete [symbol]: true
strict delete [symbol]: true
get [zero]: zero
strict set [zero]: TypeError: Attempted to assign to readonly property.
sloppy set [zero]: TypeError: Attempted to assign to readonly property.
has [zero]: true
sloppy delete [zero]: TypeError: Unable to delete property.
strict delete [zero]: TypeError: Unable to delete property.
get [negative zero]: zero
strict set [negative zero]: TypeError: Attempted to assign to readonly property.
sloppy set [negative zero]: TypeError: Attempted to assign to readonly property.
has [negative zero]: true
sloppy delete [negative zero]: TypeError: Unable to delete property.
strict delete [negative zero]: TypeError: Unable to delete property.
get [two to the 32]: undefined
strict set [two to the 32]: TypeError: Attempting to define property on object that is not extensible.
sloppy set [two to the 32]: TypeError: Attempting to define property on object that is not extensible.
has [two to the 32]: false
sloppy delete [two to the 32]: true
strict delete [two to the 32]: true
get [fraction]: undefined
strict set [fraction]: TypeError: Attempting to define property on object that is not extensible.
sloppy set [fraction]: TypeError: Attempting to define property on object that is not extensible.
has [fraction]: false
sloppy delete [fraction]: true
strict delete [fraction]: true
get [counting key]: 1
  conversions 1
strict set [counting key]: TypeError: Attempted to assign to readonly property.
  conversions 2
has [counting key]: true
  conversions 3
sloppy delete [counting key]: TypeError: Unable to delete property.
  conversions 4
== proxy
  trap get x
get x: 1
  trap get length
get length: undefined
  trap get absent
get absent: undefined
  trap set x
  trap getOwnPropertyDescriptor x
  trap defineProperty x
  trap get x
strict set x: 2
  trap set x
  trap getOwnPropertyDescriptor x
  trap defineProperty x
  trap get x
sloppy set x: 2
  trap has x
has x: true
  trap deleteProperty x
sloppy delete x: true
  trap deleteProperty x
strict delete x: true
  trap get x
get [string]: 1
  trap set x
  trap getOwnPropertyDescriptor x
  trap defineProperty x
  trap get x
strict set [string]: 2
  trap set x
  trap getOwnPropertyDescriptor x
  trap defineProperty x
  trap get x
sloppy set [string]: 2
  trap has x
has [string]: true
  trap deleteProperty x
sloppy delete [string]: true
  trap deleteProperty x
strict delete [string]: true
  trap get length
get [length]: undefined
  trap set length
  trap getOwnPropertyDescriptor length
  trap defineProperty length
  trap get length
strict set [length]: 2
  trap set length
  trap getOwnPropertyDescriptor length
  trap defineProperty length
  trap get length
sloppy set [length]: 2
  trap has length
has [length]: false
  trap deleteProperty length
sloppy delete [length]: true
  trap deleteProperty length
strict delete [length]: true
  trap get Symbol(key)
get [symbol]: undefined
  trap set Symbol(key)
  trap getOwnPropertyDescriptor Symbol(key)
  trap defineProperty Symbol(key)
  trap get Symbol(key)
strict set [symbol]: 2
  trap set Symbol(key)
  trap getOwnPropertyDescriptor Symbol(key)
  trap defineProperty Symbol(key)
  trap get Symbol(key)
sloppy set [symbol]: 2
  trap has Symbol(key)
has [symbol]: false
  trap deleteProperty Symbol(key)
sloppy delete [symbol]: true
  trap deleteProperty Symbol(key)
strict delete [symbol]: true
  trap get 0
get [zero]: undefined
  trap set 0
  trap getOwnPropertyDescriptor 0
  trap defineProperty 0
  trap get 0
strict set [zero]: 2
  trap set 0
  trap getOwnPropertyDescriptor 0
  trap defineProperty 0
  trap get 0
sloppy set [zero]: 2
  trap has 0
has [zero]: false
  trap deleteProperty 0
sloppy delete [zero]: true
  trap deleteProperty 0
strict delete [zero]: true
  trap get 0
get [negative zero]: undefined
  trap set 0
  trap getOwnPropertyDescriptor 0
  trap defineProperty 0
  trap get 0
strict set [negative zero]: 2
  trap set 0
  trap getOwnPropertyDescriptor 0
  trap defineProperty 0
  trap get 0
sloppy set [negative zero]: 2
  trap has 0
has [negative zero]: false
  trap deleteProperty 0
sloppy delete [negative zero]: true
  trap deleteProperty 0
strict delete [negative zero]: true
  trap get 4294967296
get [two to the 32]: undefined
  trap set 4294967296
  trap getOwnPropertyDescriptor 4294967296
  trap defineProperty 4294967296
  trap get 4294967296
strict set [two to the 32]: 2
  trap set 4294967296
  trap getOwnPropertyDescriptor 4294967296
  trap defineProperty 4294967296
  trap get 4294967296
sloppy set [two to the 32]: 2
  trap has 4294967296
has [two to the 32]: false
  trap deleteProperty 4294967296
sloppy delete [two to the 32]: true
  trap deleteProperty 4294967296
strict delete [two to the 32]: true
  trap get 1.5
get [fraction]: undefined
  trap set 1.5
  trap getOwnPropertyDescriptor 1.5
  trap defineProperty 1.5
  trap get 1.5
strict set [fraction]: 2
  trap set 1.5
  trap getOwnPropertyDescriptor 1.5
  trap defineProperty 1.5
  trap get 1.5
sloppy set [fraction]: 2
  trap has 1.5
has [fraction]: false
  trap deleteProperty 1.5
sloppy delete [fraction]: true
  trap deleteProperty 1.5
strict delete [fraction]: true
  trap get x
get [counting key]: 1
  conversions 1
  trap set x
  trap getOwnPropertyDescriptor x
  trap defineProperty x
  trap get x
strict set [counting key]: 2
  conversions 3
  trap has x
has [counting key]: true
  conversions 4
  trap deleteProperty x
sloppy delete [counting key]: true
  conversions 5
null[key]: TypeError
  order []
undefined[key]: TypeError
  order []
key in null: TypeError
  order []
delete null[key]: TypeError
  order []
present present three true true
true true false false
1 undefined default
a b
*/
