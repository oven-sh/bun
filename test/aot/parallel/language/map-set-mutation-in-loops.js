// Loops over a Map or a Set, directly and through keys(), values() and entries(), whose body deletes, adds, overwrites or clears. A loop visits what plain Bun visits: an entry added during the loop, never an entry deleted before the loop reached it.
// CALLS+ mapDestructured OpenPairIterationInFrame
// CALLS+ mapDestructured StepIterationInFrame
// CALLS+ mapEntriesDestructured OpenTableIterationInFrame
// CALLS+ mapEntriesDestructured StepIterationInFrame
// CALLS+ keysThroughGenerator StepIteration\b
import vm from "node:vm";

const limit = 16;

function text(value) {
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "symbol":
      return String(value);
    case "object":
      if (value === null) return "null";
      return Array.isArray(value) ? "[" + value.map(text).join() + "]" : "{" + value.name + "}";
    default:
      return JSON.stringify(value);
  }
}

function checkPairs(seen, pairs) {
  seen.push(new Set(pairs).size === pairs.length ? "fresh pairs" : "SHARED PAIRS");
  return seen;
}

function mapDestructured(map, change) {
  const seen = [];
  for (const [key, value] of map) {
    seen.push(text(key) + "=" + text(value));
    if (seen.length === limit) break;
    change(map, seen.length - 1);
  }
  return seen;
}
function mapEntriesDestructured(map, change) {
  const seen = [];
  for (const [key, value] of map.entries()) {
    seen.push(text(key) + "=" + text(value));
    if (seen.length === limit) break;
    change(map, seen.length - 1);
  }
  return seen;
}

const mapLoops = {
  "map, destructured": mapDestructured,
  "map, whole pair"(map, change) {
    const seen = [];
    const pairs = [];
    for (const pair of map) {
      seen.push(pair.length + ":" + text(pair[0]) + "=" + text(pair[1]));
      pair[0] = 1;
      pairs.push(pair);
      if (seen.length === limit) break;
      change(map, seen.length - 1);
    }
    return checkPairs(seen, pairs);
  },
  "map.keys()"(map, change) {
    const seen = [];
    for (const key of map.keys()) {
      seen.push(text(key));
      if (seen.length === limit) break;
      change(map, seen.length - 1);
    }
    return seen;
  },
  "map.values()"(map, change) {
    const seen = [];
    for (const value of map.values()) {
      seen.push(text(value));
      if (seen.length === limit) break;
      change(map, seen.length - 1);
    }
    return seen;
  },
  "map.entries(), destructured": mapEntriesDestructured,
  "map.entries(), whole pair"(map, change) {
    const seen = [];
    const pairs = [];
    for (const pair of map.entries()) {
      seen.push(pair.length + ":" + text(pair[0]) + "=" + text(pair[1]));
      pair[0] = 1;
      pairs.push(pair);
      if (seen.length === limit) break;
      change(map, seen.length - 1);
    }
    return checkPairs(seen, pairs);
  },
};

const setLoops = {
  set(set, change) {
    const seen = [];
    for (const value of set) {
      seen.push(text(value));
      if (seen.length === limit) break;
      change(set, seen.length - 1);
    }
    return seen;
  },
  "set.values()"(set, change) {
    const seen = [];
    for (const value of set.values()) {
      seen.push(text(value));
      if (seen.length === limit) break;
      change(set, seen.length - 1);
    }
    return seen;
  },
  "set.keys()"(set, change) {
    const seen = [];
    for (const value of set.keys()) {
      seen.push(text(value));
      if (seen.length === limit) break;
      change(set, seen.length - 1);
    }
    return seen;
  },
  "set.entries(), destructured"(set, change) {
    const seen = [];
    for (const [first, second] of set.entries()) {
      seen.push(text(first) + "=" + text(second));
      if (seen.length === limit) break;
      change(set, seen.length - 1);
    }
    return seen;
  },
  "set.entries(), whole pair"(set, change) {
    const seen = [];
    const pairs = [];
    for (const pair of set.entries()) {
      seen.push(pair.length + ":" + text(pair[0]) + "=" + text(pair[1]));
      pair[0] = 1;
      pairs.push(pair);
      if (seen.length === limit) break;
      change(set, seen.length - 1);
    }
    return checkPairs(seen, pairs);
  },
};

const keyKinds = {
  strings: { keys: () => ["a", "b", "c", "d", "e"], newKey: n => "new" + n },
  numbers: { keys: () => [1, 2.5, -0, NaN, 1e21], newKey: n => 100 + n },
  objects: { keys: () => ["p", "q", "r", "s", "t"].map(name => ({ name })), newKey: n => ({ name: "new" + n }) },
  mixed: { keys: () => ["a", 1, undefined, null, { name: "o" }, Symbol("y"), true], newKey: n => (n % 2 ? "new" + n : 100 + n) },
};

const valueKinds = {
  "cells and nullish": index => ["v0", undefined, null, { name: "v3" }, "v4"][index % 5],
  numbers: index => index * 1.5,
};

const add = (collection, key) => (collection instanceof Map ? collection.set(key, "added") : collection.add(key));

const changes = {
  nothing() {},
  "deletes the current key"(collection, step, keys) {
    collection.delete(keys[step]);
  },
  "deletes an earlier key"(collection, step, keys) {
    if (step === 2) collection.delete(keys[0]);
  },
  "deletes a later key"(collection, step, keys) {
    if (step === 1) collection.delete(keys[3]);
  },
  "deletes every later key"(collection, step, keys) {
    if (step === 1) for (const key of keys.slice(2)) collection.delete(key);
  },
  "deletes the current key and adds it again"(collection, step, keys) {
    if (step < 2) {
      collection.delete(keys[step]);
      add(collection, keys[step]);
    }
  },
  "deletes a later key and adds it again"(collection, step, keys) {
    if (step === 0) {
      collection.delete(keys[1]);
      add(collection, keys[1]);
    }
  },
  "adds keys"(collection, step, keys, newKey) {
    if (collection.size < 11) add(collection, newKey(step));
  },
  "adds a key of another kind"(collection, step) {
    if (step === 1) for (const key of [0.5, "text", undefined, { name: "other" }]) add(collection, key);
  },
  "overwrites the next value"(collection, step, keys) {
    if (collection instanceof Map && step + 1 < keys.length) collection.set(keys[step + 1], step % 2 ? { name: "overwritten" } : step + 0.5);
  },
  clears(collection, step) {
    if (step === 1) collection.clear();
  },
  "clears and adds"(collection, step, keys, newKey) {
    if (step === 1) {
      collection.clear();
      add(collection, newKey(0));
      add(collection, keys[0]);
    }
  },
};

function report(name, loops, make, change, run) {
  for (const [loop, iterate] of Object.entries(loops)) {
    const once = () => {
      const { collection, keys, newKey } = make();
      const seen = iterate(collection, (changed, step) => run(changed, step, keys, newKey));
      return seen.join(" ") + " (size " + collection.size + ")";
    };
    const first = once();
    const second = once();
    console.log(name + " | " + change + " | " + loop + ": " + (first === second ? first : first + " BUT THEN " + second));
  }
}

for (const [keyKind, { keys: makeKeys, newKey }] of Object.entries(keyKinds)) {
  for (const [change, run] of Object.entries(changes)) {
    for (const [valueKind, valueAt] of Object.entries(valueKinds)) {
      report("map of " + keyKind + " to " + valueKind, mapLoops, () => {
        const keys = makeKeys();
        const collection = new Map();
        keys.forEach((key, index) => collection.set(key, valueAt(index)));
        return { collection, keys, newKey };
      }, change, run);
    }
    report("set of " + keyKind, setLoops, () => {
      const keys = makeKeys();
      const collection = new Set();
      for (const key of keys) collection.add(key);
      return { collection, keys, newKey };
    }, change, run);
  }
}

function growth(collection, count) {
  let next = 1;
  let steps = 0;
  let checksum = 0;
  add(collection, "k0");
  return {
    visit(key) {
      steps++;
      checksum = (checksum * 31 + Number(key.slice(1)) + 1) % 1000003;
      for (let added = 0; added < 2 && next < count; added++) add(collection, "k" + next++);
      if (steps % 3 === 0) collection.delete("k" + (steps - 3));
      if (steps % 7 === 0) collection.delete("k" + (next - 1));
    },
    summary: () => steps + " steps, size " + collection.size + ", checksum " + checksum,
  };
}

function* keysThroughGenerator(map) {
  for (const [key] of map) yield key;
}

const growthLoops = {
  map(count) {
    const map = new Map();
    const grown = growth(map, count);
    for (const [key] of map) grown.visit(key);
    return grown.summary();
  },
  "map.keys()"(count) {
    const map = new Map();
    const grown = growth(map, count);
    for (const key of map.keys()) grown.visit(key);
    return grown.summary();
  },
  "map.entries()"(count) {
    const map = new Map();
    const grown = growth(map, count);
    for (const [key, value] of map.entries()) grown.visit(value === "added" ? key : "k-1");
    return grown.summary();
  },
  "map, suspended between steps"(count) {
    const map = new Map();
    const grown = growth(map, count);
    for (const key of keysThroughGenerator(map)) grown.visit(key);
    return grown.summary();
  },
  set(count) {
    const set = new Set();
    const grown = growth(set, count);
    for (const key of set) grown.visit(key);
    return grown.summary();
  },
  "set.values()"(count) {
    const set = new Set();
    const grown = growth(set, count);
    for (const key of set.values()) grown.visit(key);
    return grown.summary();
  },
  "set.entries()"(count) {
    const set = new Set();
    const grown = growth(set, count);
    for (const [key, same] of set.entries()) grown.visit(key === same ? key : "k-1");
    return grown.summary();
  },
};

for (const count of [1, 4, 5, 8, 9, 16, 63, 64, 65, 254, 255, 256, 1000])
  for (const [loop, run] of Object.entries(growthLoops)) console.log("grows to " + count + " | " + loop + ": " + run(count));

function nestedLoops(map) {
  const seen = [];
  for (const [outer] of map) {
    for (const [inner] of map) {
      seen.push(outer + inner);
      if (outer === "b" && inner === "a") map.delete("c");
      if (outer === "d" && inner === "d") map.set("e", 5);
    }
  }
  return seen.join(" ");
}
console.log("nested loops: " + nestedLoops(new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]])));

function loopAgainAfterBreak(set) {
  const seen = [];
  for (const value of set) {
    seen.push(value);
    if (value === "b") break;
  }
  set.delete("a");
  for (const value of set) seen.push(value);
  return seen.join(" ");
}
console.log("a second loop after break: " + loopAgainAfterBreak(new Set(["a", "b", "c"])));

const pairs = () => [["a", 1], ["b", 2]];
const fixed = (...values) => () => values.values();

class MapWithOwnIterator extends Map {
  *[Symbol.iterator]() {
    yield ["from the subclass", this.size];
  }
}
class MapWithOwnMethods extends Map {
  keys() {
    return ["keys of the subclass"].values();
  }
  values() {
    return ["values of the subclass"].values();
  }
  entries() {
    return [["entries of", "the subclass"]].values();
  }
}
class MapSubclass extends Map {}
class SetWithOwnIterator extends Set {
  *[Symbol.iterator]() {
    yield "from the subclass";
  }
}
class SetWithOwnMethods extends Set {
  keys() {
    return ["keys of the subclass"].values();
  }
  values() {
    return ["values of the subclass"].values();
  }
  entries() {
    return [["entries of", "the subclass"]].values();
  }
}
class SetSubclass extends Set {}

const changedRealm = `
  Map.prototype[Symbol.iterator] = function* () { yield ["their", "iterator"]; };
  Map.prototype.keys = Map.prototype.values = () => ["their method"].values();
  Map.prototype.entries = () => [["their", "entries"]].values();
  Set.prototype[Symbol.iterator] = function* () { yield "their iterator"; };
  Set.prototype.keys = Set.prototype.values = () => ["their method"].values();
  Set.prototype.entries = () => [["their", "entries"]].values();
`;

const otherMaps = {
  "subclass with its own iterator": () => new MapWithOwnIterator(pairs()),
  "subclass with its own methods": () => new MapWithOwnMethods(pairs()),
  "subclass without overrides": () => new MapSubclass(pairs()),
  "own entries": () => Object.assign(new Map(pairs()), { entries: fixed(["own", "entries"]) }),
  "own keys and values": () => Object.assign(new Map(pairs()), { keys: fixed("own keys"), values: fixed("own values") }),
  "own iterator": () => Object.assign(new Map(pairs()), { [Symbol.iterator]: fixed(["own", "iterator"]) }),
  "own property that is no method": () => Object.assign(new Map(pairs()), { name: "named" }),
  "another prototype": () => Object.setPrototypeOf(new Map(pairs()), { __proto__: Map.prototype, entries: fixed(["inherited", "entries"]) }),
  frozen: () => Object.freeze(new Map(pairs())),
  "another realm": () => vm.runInNewContext("new Map([['a', 1], ['b', 2]])"),
  "another realm with changed prototypes": () => vm.runInNewContext(changedRealm + "new Map([['a', 1], ['b', 2]])"),
  "an array of pairs": () => pairs(),
};
const otherSets = {
  "subclass with its own iterator": () => new SetWithOwnIterator(["a", "b"]),
  "subclass with its own methods": () => new SetWithOwnMethods(["a", "b"]),
  "subclass without overrides": () => new SetSubclass(["a", "b"]),
  "own entries": () => Object.assign(new Set(["a", "b"]), { entries: fixed(["own", "entries"]) }),
  "own keys and values": () => Object.assign(new Set(["a", "b"]), { keys: fixed("own keys"), values: fixed("own values") }),
  "own iterator": () => Object.assign(new Set(["a", "b"]), { [Symbol.iterator]: fixed("own iterator") }),
  "own property that is no method": () => Object.assign(new Set(["a", "b"]), { name: "named" }),
  "another prototype": () => Object.setPrototypeOf(new Set(["a", "b"]), { __proto__: Set.prototype, values: fixed("inherited values") }),
  frozen: () => Object.freeze(new Set(["a", "b"])),
  "another realm": () => vm.runInNewContext("new Set(['a', 'b'])"),
  "another realm with changed prototypes": () => vm.runInNewContext(changedRealm + "new Set(['a', 'b'])"),
  "an array": () => ["a", "b"],
};

for (const [name, make] of Object.entries(otherMaps)) report("map: " + name, mapLoops, () => ({ collection: make() }), "nothing", changes.nothing);
for (const [name, make] of Object.entries(otherSets)) report("set: " + name, setLoops, () => ({ collection: make() }), "nothing", changes.nothing);

const deletesB = collection => void collection.delete("b");
for (const name of ["subclass without overrides", "own property that is no method", "frozen", "another realm"]) {
  report("map: " + name, mapLoops, () => ({ collection: otherMaps[name]() }), "deletes a later key", deletesB);
  report("set: " + name, setLoops, () => ({ collection: otherSets[name]() }), "deletes a later key", deletesB);
}
