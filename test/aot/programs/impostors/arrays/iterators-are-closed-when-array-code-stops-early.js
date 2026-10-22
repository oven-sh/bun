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

function counting(limit, options = {}) {
  let count = 0;
  return {
    [Symbol.iterator]() {
      log.push("iterator");
      return this;
    },
    next(sent) {
      log.push("next");
      if (options.nextThrows === count) throw new RangeError("next");
      return count < limit ? { done: false, value: count++ } : { done: true, value: "finished" };
    },
    return(value) {
      log.push("return");
      if (options.returnThrows) throw new EvalError("return");
      return options.returnsNoObject ? 5 : { done: true, value };
    },
  };
}

function* generator() {
  try {
    log.push("started");
    yield 0;
    yield 1;
    yield 2;
    log.push("ran to the end");
  } finally {
    log.push("finally");
  }
}

const uses = {
  walkAll(list) {
    const seen = [];
    for (const value of list) seen.push(value);
    return seen;
  },
  breakAtOnce(list) {
    for (const value of list) break;
    return "left";
  },
  returnTheSecond(list) {
    let count = 0;
    for (const value of list) if (count++ === 1) return value;
    return "none";
  },
  throwInTheBody(list) {
    for (const value of list) throw new SyntaxError("body");
  },
  continueAnOuterLoop(list) {
    outer: for (let turn = 0; turn < 1; turn++) {
      for (const value of list) continue outer;
    }
    return "left";
  },
  takeNone(list) {
    const [] = list;
    return "taken";
  },
  takeTwo(list) {
    const [a, b] = list;
    return [a, b];
  },
  takeFive(list) {
    const [a, b, c, d, e] = list;
    return [a, b, c, d, e];
  },
  takeExactlyThree(list) {
    const [a, b, c] = list;
    return [a, b, c];
  },
  takeOneAndTheRest(list) {
    const [a, ...rest] = list;
    return [a, rest];
  },
  aDefaultThrows(list) {
    const [a, b, c, d = (() => { throw new SyntaxError("default"); })()] = list;
    return [a, b, c, d];
  },
  aTargetThrows(list) {
    const target = { set first(value) { throw new SyntaxError("target"); } };
    [target.first] = list;
    return "stored";
  },
  spread(list) {
    return [...list];
  },
  spreadIntoACall(list) {
    return Math.max(...list);
  },
  from(list) {
    return Array.from(list);
  },
  fromWithAMapperThatThrows(list) {
    return Array.from(list, value => { throw new SyntaxError("mapper"); });
  },
  delegate(list) {
    function* all() {
      return yield* list;
    }
    const outer = all();
    return [outer.next(), outer.return("stopped"), outer.next()];
  },
  intoASet(list) {
    return new Set(list).size;
  },
};

const makers = {
  "three values": () => counting(3),
  "no values": () => counting(0),
  "a return that throws": () => counting(3, { returnThrows: true }),
  "a return that gives no object": () => counting(3, { returnsNoObject: true }),
  "a next that throws at once": () => counting(3, { nextThrows: 0 }),
  "a next that throws later": () => counting(3, { nextThrows: 1 }),
  "a generator": () => generator(),
  "an array": () => [0, 1, 2],
};

for (const use in uses) {
  for (let i = 0; i < 1000; i++) {
    try {
      uses[use]([0, 1, 2]);
    } catch {}
  }
}

for (const name in makers) {
  for (const use in uses) {
    log.length = 0;
    attempt(name + ", " + use, () => uses[use](makers[name]()));
    console.log("  log: " + log.join(" "));
  }
}
