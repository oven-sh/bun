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

function* each(list) {
  log.push("start");
  try {
    for (let i = 0; i < list.length; i++) yield list[i];
    log.push("end");
  } finally {
    log.push("finally");
  }
}

function* eachOf(list) {
  for (const value of list) yield value;
}

function* twice(list) {
  yield* each(list);
  yield* each(list);
}

function* stubborn(list) {
  try {
    yield* list;
  } finally {
    log.push("cleanup");
    yield "yielded while closing";
    log.push("after the cleanup");
  }
}

function* overriding(list) {
  try {
    yield list[0];
  } finally {
    return "returned while closing";
  }
}

function* pairs(list) {
  for (let i = 0; i < list.length; i++) yield [i, list[i]];
}

const uses = {
  sum(list) {
    let total = 0;
    for (const value of each(list)) total += value;
    return total;
  },
  firstAboveOne(list) {
    for (const value of each(list)) if (value > 1) return value;
    return "none";
  },
  breakAtOnce(list) {
    for (const value of each(list)) break;
    return "left";
  },
  throwInTheBody(list) {
    for (const value of each(list)) throw new RangeError("body");
    return "nothing to throw for";
  },
  spread: list => [...each(list)],
  firstTwo(list) {
    const [a, b] = each(list);
    return [a, b];
  },
  from: list => Array.from(each(list), value => value),
  largest: list => Math.max(...each(list)),
  byIteration(list) {
    const seen = [];
    for (const value of eachOf(list)) seen.push(value);
    return seen;
  },
  both(list) {
    const seen = [];
    for (const value of twice(list)) seen.push(value);
    return seen;
  },
  bothButLeftEarly(list) {
    let count = 0;
    for (const value of twice(list)) if (++count === 4) break;
    return count;
  },
  nested(list) {
    const seen = [];
    for (const outer of each(list)) for (const inner of each(list)) seen.push(String(outer) + String(inner));
    return seen.length > 9 ? seen.length : seen;
  },
  stubbornLeft(list) {
    for (const value of stubborn(list)) return value;
    return "nothing";
  },
  stubbornTaken(list) {
    const [first] = stubborn(list);
    return first;
  },
  overridden(list) {
    for (const value of overriding(list)) return "the loop's own result";
    return "nothing";
  },
  pairsOf(list) {
    const seen = [];
    for (const [index, value] of pairs(list)) seen.push(index, value);
    return seen.length > 12 ? seen.length : seen;
  },
  changedInTheBody(list) {
    const seen = [];
    for (const value of each(list)) {
      seen.push(value);
      if (seen.length === 1 && typeof list === "object" && list !== null) list.length = 2;
      if (seen.length === 6) break;
    }
    return seen;
  },
  keptAndResumed(list) {
    const steps = each(list);
    for (const value of steps) break;
    return [steps.next(), [...steps]];
  },
};

class Loud extends Array {
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const makers = {
  "an array": () => [3, 1, 2],
  "an empty array": () => [],
  "an array with a hole": () => [3, , 2],
  "doubles": () => [3.5, 1.5, 2.5],
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "a subclass": () => Loud.of(3, 1, 2),
  "a string": () => "312",
  "a typed array": () => new Uint8Array([3, 1, 2]),
  "a Set": () => new Set([3, 1, 2]),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "a frozen array": () => Object.freeze([3, 1, 2]),
  "null": () => null,
};

for (const use in uses) {
  for (let i = 0; i < 500; i++) {
    try {
      uses[use]([3, 1, 2]);
    } catch {}
  }
}

for (const name in makers) {
  for (const use in uses) {
    log.length = 0;
    let answer;
    try {
      answer = describe(uses[use](makers[name]()));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(name + ", " + use + ": " + answer + " (" + (log.length > 14 ? log.length + " entries" : log.join(" ")) + ")");
  }
}
