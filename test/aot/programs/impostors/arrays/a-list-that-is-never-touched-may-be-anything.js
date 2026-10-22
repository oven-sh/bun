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

const uses = {
  sumOfTheFirst(list, count) {
    let total = 0;
    for (let i = 0; i < count; i++) total += list[i];
    return total;
  },
  pushIf(list, count) {
    if (count > 0) return list.push(1);
    return "not pushed";
  },
  walkIf(list, count) {
    const seen = [];
    if (count > 0) for (const value of list) seen.push(value);
    return seen;
  },
  lengthIf(list, count) {
    return count > 0 ? list.length : "not read";
  },
  andLength(list, count) {
    return count > 0 && list.length;
  },
  storeTheFirst(list, count) {
    for (let i = 0; i < count; i++) list[i] = i;
    return "stored " + count;
  },
  mapIf(list, count) {
    return count > 0 ? list.map(value => value) : "not mapped";
  },
  spreadIf(list, count) {
    return count > 0 ? [...list] : "not spread";
  },
  takeIf(list, count) {
    if (count === 0) return "not taken";
    const [first] = list;
    return first;
  },
  afterAReturn(list, count) {
    if (count === 0) return "left early";
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  inACatch(list, count) {
    try {
      if (count === 0) throw new RangeError("nothing");
      return "no error";
    } catch {
      return "caught";
    } finally {
      if (count > 0) list.length;
    }
  },
  inAClosureNobodyCalls(list, count) {
    const read = () => list.length + list[0];
    return count > 0 ? read() : "not called";
  },
  whileLoop(list, count) {
    let i = 0;
    while (i < count && i < list.length) i++;
    return i;
  },
  optional(list, count) {
    return [list?.length, list?.[0], list?.push?.(1)];
  },
  shortCircuit(list, count) {
    return list && list.length && list[0];
  },
  nullish(list, count) {
    return (list ?? [7]).length;
  },
};

const values = {
  null: null,
  undefined: undefined,
  "a number": 5,
  zero: 0,
  "a string": "ab",
  "an empty string": "",
  true: true,
  "a symbol": Symbol("list"),
  "a big integer": 5n,
  "an empty object": {},
  "a function": function () {},
};

for (const use in uses) {
  for (let i = 0; i < 1000; i++) {
    uses[use]([1, 2, 3], 2);
    uses[use]([1, 2, 3], 0);
  }
}

for (const name in values) {
  for (const use in uses) {
    attempt(name + ", " + use + ", never touched", () => uses[use](values[name], 0));
    attempt(name + ", " + use + ", touched", () => uses[use](values[name], 1));
  }
}
