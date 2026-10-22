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

function holderOf(answers) {
  let reads = 0;
  return {
    get items() {
      return answers[reads++ % answers.length];
    },
    get reads() {
      return reads;
    },
  };
}

function classHolderOf(answers) {
  let reads = 0;
  class Holder {
    get items() {
      return answers[reads++ % answers.length];
    }
    get reads() {
      return reads;
    }
  }
  return new Holder();
}

function proxyHolderOf(answers) {
  let reads = 0;
  return new Proxy({}, { get: (target, key) => (key === "reads" ? reads : answers[reads++ % answers.length]) });
}

const uses = {
  sum(holder) {
    let total = 0;
    for (let i = 0; i < holder.items.length; i++) total += holder.items[i];
    return total;
  },
  lastOne(holder) {
    return holder.items[holder.items.length - 1];
  },
  guarded(holder) {
    return Array.isArray(holder.items) ? holder.items.length : "no array";
  },
  guardedPush(holder) {
    if (holder.items && holder.items.push) return holder.items.push(9);
    return "no push";
  },
  truthyThenWalk(holder) {
    const seen = [];
    if (holder.items) for (const value of holder.items) seen.push(value);
    return seen;
  },
  lengthThenSpread(holder) {
    return holder.items.length > 0 ? [...holder.items] : "empty";
  },
  optional(holder) {
    return holder.items?.length + "/" + holder.items?.[0];
  },
  typeThenUse(holder) {
    return typeof holder.items === "object" ? holder.items.length : "no object";
  },
  twice(holder) {
    return holder.items === holder.items;
  },
};

const sequences = {
  "always one array": () => { const list = [1, 2, 3]; return [list]; },
  "an array, then a string": () => [[1, 2, 3], "abcd"],
  "a string, then an array": () => ["abcd", [1, 2, 3]],
  "an array, then an array-like": () => [[1, 2, 3], { length: 1, 0: "like" }],
  "an array, then null": () => [[1, 2, 3], null],
  "an array, then undefined": () => [[1, 2, 3], undefined],
  "an array, then a shorter array": () => [[1, 2, 3], [9]],
  "an array, then a longer array of doubles": () => [[1, 2, 3], [0.5, 1.5, 2.5, 3.5, 4.5]],
  "an array, then a Set": () => [[1, 2, 3], new Set([7])],
  "an array, then a typed array": () => [[1, 2, 3], new Uint8Array([7, 8])],
  "an array, then a number": () => [[1, 2, 3], 5],
};

const holders = { "an object literal": holderOf, "a class": classHolderOf, "a proxy": proxyHolderOf };

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]({ items: [1, 2, 3] });

for (const kind in holders) {
  for (const name in sequences) {
    for (const use in uses) {
      const holder = holders[kind](sequences[name]());
      let answer;
      try {
        answer = describe(uses[use](holder));
      } catch (error) {
        answer = "threw " + error.constructor.name;
      }
      console.log(kind + ", " + name + ", " + use + ": " + answer + " after " + holder.reads + " reads");
    }
  }
}
