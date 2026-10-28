// Loops over array.keys() and array.entries() whose body changes the array: it grows, shrinks, changes its element storage, gets holes, an accessor or another prototype. Each step reads the length and the element again, as the array iterator of plain Bun does.
// CALLS+ arrayEntriesDestructured OpenTableIterationInFrame
// CALLS+ arrayEntriesDestructured StepIterationInFrame
const limit = 12;

function text(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  return JSON.stringify(value);
}

function arrayEntriesDestructured(array, change) {
  const seen = [];
  for (const [index, value] of array.entries()) {
    seen.push(index + "=" + text(value));
    if (seen.length === limit) break;
    change(array, index);
  }
  return seen;
}

const loops = {
  "entries, destructured": arrayEntriesDestructured,
  "entries, index only"(array, change) {
    const seen = [];
    for (const [index] of array.entries()) {
      seen.push(String(index));
      if (seen.length === limit) break;
      change(array, index);
    }
    return seen;
  },
  "entries, value only"(array, change) {
    const seen = [];
    for (const [, value] of array.entries()) {
      seen.push(text(value));
      if (seen.length === limit) break;
      change(array, seen.length - 1);
    }
    return seen;
  },
  "entries, whole pair"(array, change) {
    const seen = [];
    const pairs = [];
    for (const pair of array.entries()) {
      const index = pair[0];
      seen.push(pair.length + ":" + index + "=" + text(pair[1]));
      pair[0] = "overwritten";
      pairs.push(pair);
      if (seen.length === limit) break;
      change(array, index);
    }
    seen.push(new Set(pairs).size === pairs.length ? "fresh pairs" : "SHARED PAIRS");
    return seen;
  },
  keys(array, change) {
    const seen = [];
    for (const index of array.keys()) {
      seen.push(index + "=" + text(array[index]));
      if (seen.length === limit) break;
      change(array, index);
    }
    return seen;
  },
};

const arrays = {
  int32: () => [1, 2, 3, 4],
  double: () => [1.5, -0, 3.25, 4.5],
  contiguous: () => ["a", { b: 1 }, null, "d"],
  "int32 with holes": () => [1, , 3, , 5],
  "double with holes": () => [1.5, , 3.5, , 5.5],
  "contiguous with holes": () => ["a", , "c", , "e"],
  "double with NaN": () => [0.5, NaN, 1.5],
  "only holes": () => new Array(3),
  empty: () => [],
};

const changes = {
  nothing() {},
  "grows with integers"(array) {
    if (array.length < 7) array.push(array.length * 10);
  },
  "grows with doubles"(array) {
    if (array.length < 7) array.push(array.length + 0.5);
  },
  "grows at the front"(array) {
    if (array.length < 7) array.unshift("front");
  },
  "shrinks through length"(array, index) {
    if (index === 1) array.length = 2;
  },
  pops(array) {
    array.pop();
  },
  shifts(array) {
    array.shift();
  },
  "is emptied"(array, index) {
    if (index === 1) array.length = 0;
  },
  "is emptied and filled again"(array, index) {
    if (index === 1) {
      array.length = 0;
      array.push("x", "y", "z", "w");
    }
  },
  "int32 to double to contiguous"(array, index) {
    if (index === 0) array[2] = 2.5;
    if (index === 1) array[3] = "text";
  },
  "deletes the next element"(array, index) {
    delete array[index + 1];
  },
  "fills the next element"(array, index) {
    if (index + 1 < array.length) array[index + 1] = "filled";
  },
  "gets a distant element"(array, index) {
    if (index === 0) array[100000] = "distant";
  },
  "inherits element 1"(array, index) {
    if (index === 0) Object.setPrototypeOf(array, { __proto__: Array.prototype, 1: "inherited" });
  },
  "inherits element 1, then loses it"(array, index) {
    if (index === 0) Object.setPrototypeOf(array, { __proto__: Array.prototype, 1: "inherited", 3: "inherited too" });
    if (index === 2) Object.setPrototypeOf(array, Array.prototype);
  },
  "gets an accessor"(array, index) {
    if (index === 0) Object.defineProperty(array, 2, { get: () => "from the getter", configurable: true });
  },
  "is frozen"(array, index) {
    if (index === 0) Object.freeze(array);
  },
  "gets its own entries and keys"(array, index) {
    if (index === 0) array.entries = array.keys = () => ["not called by a loop that has started"].values();
  },
};

class Reversed extends Array {
  keys() {
    return [...super.keys()].reverse().values();
  }
  *entries() {
    for (let index = this.length - 1; index >= 0; index--) yield [index, this[index]];
  }
}
class Subclass extends Array {}

function withHole(array) {
  array.length = 3;
  array[0] = 1;
  array[2] = 3;
  return array;
}

const otherReceivers = {
  "own entries and keys": () => Object.assign([1, 2, 3], { entries: () => [["own", "entries"]].values(), keys: () => ["own keys"].values() }),
  "subclass with its own keys and entries": () => Reversed.from([1, 2, 3]),
  "subclass without overrides": () => withHole(new Subclass()),
  frozen: () => Object.freeze([1, , 3]),
  sealed: () => Object.seal([1.5, , 3.5]),
  "not extensible": () => Object.preventExtensions(["a", , "c"]),
  "prototype with an element": () => Object.setPrototypeOf([1, , 3], { __proto__: Array.prototype, 1: "inherited" }),
  "no prototype, borrowed methods": () => Object.assign(Object.setPrototypeOf([1, , 3], null), { entries: Array.prototype.entries, keys: Array.prototype.keys }),
  "own property that is no element": () => Object.assign([1, , 3], { name: "named" }),
  "accessor element": () => Object.defineProperty([1, 2, 3], 1, { get: () => "from the getter" }),
  sparse: () => Object.assign([], { 0: "first", 100000: "last" }),
  "array-like with borrowed methods": () => ({ length: 2, 0: "x", 1: "y", entries: Array.prototype.entries, keys: Array.prototype.keys }),
  proxy: () => new Proxy([1, , 3], {}),
  "typed array": () => new Uint8Array([7, 8, 9]),
  map: () => new Map([["k", "v"], ["l", "w"]]),
  set: () => new Set(["s", "t"]),
};

function report(receiver, make, change, run) {
  for (const [loop, iterate] of Object.entries(loops)) {
    const first = iterate(make(), run).join(" ");
    const second = iterate(make(), run).join(" ");
    console.log(receiver + " | " + change + " | " + loop + ": " + (first === second ? first : first + " BUT THEN " + second));
  }
}

for (const [receiver, make] of Object.entries(arrays))
  for (const [change, run] of Object.entries(changes)) report(receiver, make, change, run);

for (const [receiver, make] of Object.entries(otherReceivers)) report(receiver, make, "nothing", changes.nothing);

for (const receiver of ["subclass without overrides", "prototype with an element", "own property that is no element", "proxy"])
  for (const change of ["grows with integers", "pops", "deletes the next element", "inherits element 1"]) report(receiver, otherReceivers[receiver], change, changes[change]);
