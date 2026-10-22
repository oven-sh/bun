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

const log = [];

class Loud extends Array {
  filter(keep) {
    log.push("the subclass's filter");
    return super.filter(keep);
  }
}

class ToSet extends Array {
  static get [Symbol.species]() {
    return function () {
      return { length: 0, filter: () => "a filter that is not Array's", reduce: () => "a reduce that is not Array's", map: () => "a map that is not Array's", join: () => "a join that is not Array's", forEach() {}, some: () => "a some that is not Array's", slice: () => "a slice that is not Array's" };
    };
  }
}

const chains = {
  mapFilter: list => list.map(value => (log.push("map " + value), value * 2)).filter(value => (log.push("filter " + value), value > 2)),
  filterMap: list => list.filter(value => (log.push("filter " + value), value > 1)).map(value => (log.push("map " + value), value * 2)),
  mapMap: list => list.map(value => (log.push("first " + value), value + 1)).map(value => (log.push("second " + value), value * 2)),
  mapReduce: list => list.map(value => (log.push("map " + value), value * 2)).reduce((total, value) => (log.push("reduce " + value), total + value), 0),
  filterMapReduce: list =>
    list
      .filter(value => (log.push("filter " + value), value !== 2))
      .map(value => (log.push("map " + value), value * 2))
      .reduce((total, value) => (log.push("reduce " + value), total + value), 0),
  mapJoin: list => list.map(value => (log.push("map " + value), value * 2)).join("-"),
  mapForEach(list) {
    list.map(value => (log.push("map " + value), value * 2)).forEach(value => log.push("forEach " + value));
    return "done";
  },
  mapSome: list => list.map(value => (log.push("map " + value), value * 2)).some(value => (log.push("some " + value), value === 2)),
  mapFind: list => list.map(value => (log.push("map " + value), value * 2)).find(value => (log.push("find " + value), value === 2)),
  mapSlice: list => list.map(value => (log.push("map " + value), value * 2)).slice(0, 1),
  sliceMap: list => list.slice(1).map(value => (log.push("map " + value), value * 2)),
  mapLength: list => list.map(value => (log.push("map " + value), value * 2)).length,
  mapFirst: list => list.map(value => (log.push("map " + value), value * 2))[0],
  mapIndexes: list => list.map((value, index, whole) => (log.push("map " + index + " of " + whole.length), index)).filter((value, index, whole) => (log.push("filter " + index + " of " + whole.length), true)),
  mapThrows: list => list.map(value => { log.push("map " + value); if (value === 1) throw new RangeError("map"); return value; }).filter(value => (log.push("filter " + value), true)),
  filterThrows: list => list.map(value => (log.push("map " + value), value)).filter(value => { log.push("filter " + value); throw new RangeError("filter"); }),
  mapChangesTheSource: list => list.map((value, index) => { log.push("map " + value); if (index === 0) list.push(9); return value; }).filter(value => (log.push("filter " + value), true)),
  filterChangesTheSource: list => list.map(value => (log.push("map " + value), value)).filter((value, index) => { log.push("filter " + value); if (index === 0) list[2] = "changed"; return true; }),
  spreadOfAMap: list => [...list.map(value => (log.push("map " + value), value * 2))],
  walkOfAMap(list) {
    const seen = [];
    for (const value of list.map(value => (log.push("map " + value), value * 2))) {
      log.push("body " + value);
      seen.push(value);
    }
    return seen;
  },
};

const makers = {
  "an array": () => [3, 1, 2],
  "an array with a hole": () => [3, , 2],
  "doubles": () => [3.5, 1, 2.5],
  "a subclass that overrides filter": () => Loud.of(3, 1, 2),
  "a species that makes other objects": () => ToSet.of(3, 1, 2),
  "a typed array": () => new Uint8Array([3, 1, 200]),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "an array with its own map": () => Object.assign([3, 1, 2], { map() { log.push("its own map"); return [7]; } }),
  "a frozen array": () => Object.freeze([3, 1, 2]),
  "an array-like under Array.prototype": () => ({ __proto__: Array.prototype, 0: 3, 1: 1, 2: 2, length: 3 }),
};

for (const chain in chains) {
  for (let i = 0; i < 500; i++) {
    try {
      chains[chain]([3, 1, 2]);
    } catch {}
  }
}

for (const name in makers) {
  for (const chain in chains) {
    log.length = 0;
    let answer;
    try {
      answer = describe(chains[chain](makers[name]()));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(name + ", " + chain + ": " + answer + " after " + log.join(", "));
  }
}
