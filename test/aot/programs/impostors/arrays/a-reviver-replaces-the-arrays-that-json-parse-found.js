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
  push() {
    return "the subclass's push";
  }
  map() {
    return "the subclass's map";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const replacements = {
  "a subclass": list => Loud.from({ length: list.length }, (_, index) => list[index]),
  "an array-like": list => ({ ...list, length: list.length }),
  "a Set": list => new Set(list),
  "a typed array": list => new Uint8Array(list),
  "a frozen array": list => Object.freeze(list),
  "a proxy": list => new Proxy(list, {}),
  "a string": list => list.join(""),
  "arguments": list => (function () { return arguments; })(...list),
  "an array with a hole": list => { delete list[1]; return list; },
  "an array under null": list => Object.setPrototypeOf(list, null),
  "an array with its own push": list => Object.assign(list, { push: () => "its own push" }),
  "a generator": list => list.values(),
  "undefined": list => undefined,
  "the array itself": list => list,
};

function read(text, replace) {
  return JSON.parse(text, (key, value) => (Array.isArray(value) ? replace(value) : value));
}

const uses = {
  push(holder) {
    return holder.items.push(9);
  },
  sum(holder) {
    let total = 0;
    for (let i = 0; i < holder.items.length; i++) total += holder.items[i];
    return total;
  },
  collect(holder) {
    const seen = [];
    for (const value of holder.items) seen.push(value);
    return seen;
  },
  doubled(holder) {
    return holder.items.map(value => value * 2);
  },
  sorted(holder) {
    return holder.items.sort((a, b) => a - b);
  },
  copied(holder) {
    return [...holder.items];
  },
  firstTwo(holder) {
    const { items: [a, b] } = holder;
    return [a, b];
  },
  lengthOf(holder) {
    return holder.items.length;
  },
  has(holder) {
    return "items" in holder;
  },
};

const text = '{"name":"holder","items":[3,1,2]}';

function round(title) {
  for (const name in replacements) for (const use in uses) attempt(title + ", " + use + ", " + name, () => uses[use](read(text, replacements[name])));
}

round("at first");
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use](JSON.parse(text));
round("after 2000 arrays");

attempt("a reviver that grows the array it walks", () =>
  JSON.parse("[1,2,3]", function (key, value) {
    if (key === "0") this.push(4);
    return value;
  }),
);
attempt("a reviver that shrinks the array it walks", () =>
  JSON.parse("[1,2,3]", function (key, value) {
    if (key === "0") this.length = 1;
    return value;
  }),
);
attempt("a reviver that drops every second element", () => JSON.parse("[1,2,3,4]", (key, value) => (key % 2 ? undefined : value)));
attempt("a reviver that freezes the array it walks", () =>
  JSON.parse("[1,2,3]", function (key, value) {
    if (key === "0") Object.freeze(this);
    return typeof value === "number" ? value * 2 : value;
  }),
);
