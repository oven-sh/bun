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

class Loud extends Array {
  map() {
    return ["the subclass's map"];
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const log = [];

const makers = {
  "an array": () => [3, 1, 2],
  "an array of promises": () => [Promise.resolve(3), 1, Promise.resolve(2)],
  "an array with a thenable": () => [3, { then(resolve) { log.push("then"); resolve("from then"); } }, 2],
  "an array with a hole": () => [3, , 2],
  "a subclass": () => Loud.of(3, 1, 2),
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "a string": () => "312",
  "a Set": () => new Set([3, 1, 2]),
  "a Map": () => new Map([[3, "c"]]),
  "a typed array": () => new Uint8Array([3, 1, 2]),
  "a generator": () => (function* () { yield 3; yield 1; yield 2; })(),
  "an async generator": () => (async function* () { yield 3; yield 1; yield 2; })(),
  "an object with both iterators": () => ({ *[Symbol.iterator]() { yield "sync"; }, async *[Symbol.asyncIterator]() { yield "async"; } }),
  "an array with its own async iterator": () => Object.assign([3, 1, 2], { async *[Symbol.asyncIterator]() { yield "its own async iterator"; } }),
  "a promise of an array": () => Promise.resolve([3, 1, 2]),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "arguments": () => (function () { return arguments; })(3, 1, 2),
  "null": () => null,
  "a number": () => 312,
};

const uses = {
  async sum(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += await list[i];
    return total;
  },
  async walk(list) {
    const seen = [];
    for (const value of list) seen.push(await value);
    return seen;
  },
  async walkAsynchronously(list) {
    const seen = [];
    for await (const value of list) seen.push(value);
    return seen;
  },
  async all(list) {
    return await Promise.all(list);
  },
  async allOfAMap(list) {
    return await Promise.all(list.map(async value => (await value) * 2));
  },
  async settled(list) {
    return (await Promise.allSettled(list)).length;
  },
  async race(list) {
    return await Promise.race(list);
  },
  async awaited(list) {
    const value = await list;
    return [Array.isArray(value), value.length];
  },
  async fromAsync(list) {
    return await Array.fromAsync(list);
  },
  async pattern(list) {
    const [first, second] = await list;
    return [await first, await second];
  },
  async *yielded(list) {
    yield* list;
  },
};

async function run(use, list) {
  const result = uses[use](list);
  if (use !== "yielded") return await result;
  const seen = [];
  for await (const value of result) seen.push(value);
  return seen;
}

for (const use in uses) for (let i = 0; i < 200; i++) await run(use, [3, 1, 2]);

for (const name in makers) {
  for (const use in uses) {
    log.length = 0;
    let answer;
    try {
      answer = describe(await run(use, makers[name]()));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(name + ", " + use + ": " + answer + (log.length ? " after " + log.join(" ") : ""));
  }
}
