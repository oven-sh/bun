function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function Bag(length) {
  this.made = "by Bag";
  this.length = "not a number";
}
Bag.prototype.push = function () {
  return "Bag's push";
};
Bag.prototype.map = function () {
  return "Bag's map";
};
Bag.prototype[Symbol.iterator] = function* () {
  yield "Bag's iterator";
};

class ToBag extends Array {
  static get [Symbol.species]() {
    return Bag;
  }
}

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  map(callback) {
    return callback === undefined ? "the subclass's map" : super.map(callback);
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

class ToTyped extends Array {
  static get [Symbol.species]() {
    return Uint8Array;
  }
}

class ToProxy extends Array {
  static get [Symbol.species]() {
    return function (length) {
      return new Proxy(new Array(length), {});
    };
  }
}

class ToLonger extends Array {
  static get [Symbol.species]() {
    return function (length) {
      return ["already", "here", "and", "longer", "than", "asked"];
    };
  }
}

const makers = {
  "a species that makes bags": () => ToBag.of(300, 1, 2),
  "a subclass that overrides": () => Loud.of(300, 1, 2),
  "a species of Uint8Array": () => ToTyped.of(300, 1, 2),
  "a species that makes proxies": () => ToProxy.of(300, 1, 2),
  "a species that makes longer arrays": () => ToLonger.of(300, 1, 2),
  "a plain array with its own constructor": () => Object.assign([300, 1, 2], { constructor: { [Symbol.species]: Bag } }),
  "an array": () => [300, 1, 2],
};

const steps = {
  map: list => list.map(value => value + 1),
  filter: list => list.filter(value => value > 0),
  slice: list => list.slice(0),
  splice: list => list.splice(0, 3),
  concat: list => list.concat([7]),
  flatMap: list => list.flatMap(value => [value]),
  flat: list => list.flat(),
};

const then = {
  lengthOf: result => result.length,
  first: result => result[0],
  push: result => result.push(9),
  sum(result) {
    let total = 0;
    for (let i = 0; i < result.length; i++) total += result[i];
    return total;
  },
  walk(result) {
    const seen = [];
    for (const value of result) seen.push(value);
    return seen;
  },
  copy: result => [...result],
  mapAgain: result => result.map(),
  isArray: result => Array.isArray(result),
};

function mapThenLength(list) {
  return list.map(value => value + 1).length;
}

function filterThenFirst(list) {
  return list.filter(value => value > 0)[0];
}

function sliceThenPush(list) {
  return list.slice().push(9);
}

function mapThenWalk(list) {
  const seen = [];
  for (const value of list.map(value => value + 1)) seen.push(value);
  return seen;
}

function concatThenSpread(list) {
  return [...list.concat([7])];
}

function mapThenSum(list) {
  const result = list.map(value => value + 1);
  let total = 0;
  for (let i = 0; i < result.length; i++) total += result[i];
  return total;
}

const together = { mapThenLength, filterThenFirst, sliceThenPush, mapThenWalk, concatThenSpread, mapThenSum };

for (let i = 0; i < 1000; i++) {
  for (const step in steps) for (const use in then) if (use !== "mapAgain") then[use](steps[step]([300, 1, 2]));
  for (const use in together) together[use]([300, 1, 2]);
}

for (const name in makers) {
  for (const step in steps) {
    const answers = [];
    for (const use in then) {
      try {
        answers.push(use + " " + describe(then[use](steps[step](makers[name]()))));
      } catch (error) {
        answers.push(use + " threw " + error.constructor.name);
      }
    }
    console.log(name + ", " + step + ": " + answers.join("; "));
  }
  for (const use in together) attempt(name + ", " + use, () => together[use](makers[name]()));
}
