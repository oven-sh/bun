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

function logging(name, number) {
  return {
    valueOf() {
      log.push(name);
      return number;
    },
    toString() {
      log.push(name + " as text");
      return String(number);
    },
  };
}

const chains = {
  mapFilter: (list, other) => list.map(value => value * 2).filter(value => value > other),
  filterMap: (list, other) => list.filter(value => value > other).map(value => value * 2),
  mapMap: (list, other) => list.map(value => value + 1).map(value => value * other),
  mapMapMap: (list, other) => list.map(value => value * 1).map(value => value - other).map(value => value * other),
  filterFilter: (list, other) => list.filter(value => value > 0).filter(value => value < other),
  mapReduce: (list, other) => list.map(value => value * 2).reduce((total, value) => total + value * other, 0),
  mapReduceFrom: (list, other) => list.map(value => value * 2).reduce((total, value) => total + value, other),
  mapSome: (list, other) => list.map(value => value * 2).some(value => value > other),
  mapEvery: (list, other) => list.map(value => value * 2).every(value => value < other),
  mapFind: (list, other) => list.map(value => value * 2).find(value => value > other),
  mapFindIndex: (list, other) => list.map(value => value * 2).findIndex(value => value > other),
  mapLength: (list, other) => list.map(value => value * other).length,
  filterLength: (list, other) => list.filter(value => value > other).length,
  mapJoin: (list, other) => list.map(value => value).join(other),
  mapTextJoin: (list, other) => list.map(value => "<" + value + ">").join(other),
  mapForEach(list, other) {
    let total = 0;
    list.map(value => value * 2).forEach(value => {
      total += value * other;
    });
    return total;
  },
  mapFlatMap: (list, other) => list.map(value => value * 2).flatMap(value => [value, value * other]),
  sliceMap: (list, other) => list.slice(1).map(value => value * other),
  sliceMapFilter: (list, other) => list.slice(0, 2).map(value => value * 2).filter(value => value > other),
  mapFirst: (list, other) => list.map(value => value * other)[0],
};

const lists = {
  "numbers": () => [3, 1, 2],
  "objects that log": () => [logging("a", 3), logging("b", 1), logging("c", 2)],
  "a number, an object that logs and a number": () => [3, logging("b", 1), 2],
  "numbers and then a big integer": () => [3, 1, 2n],
  "an object that logs and then a big integer": () => [logging("a", 3), 1, 2n],
  "an object that logs and then a symbol": () => [logging("a", 3), Symbol("b"), logging("c", 2)],
  "strings": () => ["3", "1", "2"],
  "an object that logs, a hole and an object that logs": () => [logging("a", 3), , logging("c", 2)],
  "an object that throws in the middle": () => [logging("a", 3), { valueOf() { log.push("throws"); throw new RangeError("element"); } }, logging("c", 2)],
};

const others = {
  "a number": () => 2,
  "an object that logs": () => logging("other", 2),
  "a big integer": () => 2n,
  "an object that throws": () => ({ valueOf() { log.push("other throws"); throw new EvalError("other"); }, toString() { log.push("other throws"); throw new EvalError("other"); } }),
};

for (const chain in chains) for (let i = 0; i < 1000; i++) chains[chain]([3, 1, 2], 2);

for (const chain in chains) {
  for (const list in lists) {
    const answers = [];
    for (const other in others) {
      log.length = 0;
      let answer;
      let seen;
      try {
        const result = chains[chain](lists[list](), others[other]());
        seen = log.join(" ");
        answer = Array.isArray(result) ? "[" + result.map(value => (typeof value === "object" ? "object" : String(value))).join(",") + "]" : typeof result === "object" ? "object" : String(result);
      } catch (error) {
        seen = log.join(" ");
        answer = error.constructor.name;
      }
      answers.push(answer + " (" + seen + ")");
    }
    console.log(chain + ", " + list + ": " + answers.join(" | "));
  }
}
