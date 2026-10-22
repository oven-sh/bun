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
  walk(list) {
    const seen = [];
    for (const value of list) seen.push(value);
    return seen;
  },
  pairs(list) {
    const seen = [];
    for (const [key, value] of list) seen.push(key + "=" + value);
    return seen;
  },
  forEach(list) {
    const seen = [];
    list.forEach((value, key, whole) => seen.push(String(key) + "=" + String(value) + (whole === list ? "" : " of another")));
    return seen;
  },
  copy: list => [...list],
  from: list => Array.from(list, entry => String(entry)),
  keys: list => [...list.keys()],
  values: list => [...list.values()],
  entries: list => [...list.entries()].length,
  first(list) {
    const [first] = list;
    return first;
  },
  lengthOf: list => list.length,
  sizeOf: list => list.size,
  byIndex: list => list[0],
  sum(list) {
    let count = 0;
    for (let i = 0; i < list.length; i++) count++;
    return count;
  },
  sort(list) {
    const answer = list.sort();
    return [answer === list, answer === undefined, [...list].map(String)];
  },
  has: list => [list.has("b"), list.has("z")],
  push: list => list.push(["z", "26"]),
  map: list => list.map(entry => entry),
  asObject: list => Object.fromEntries(list),
  asMap: list => new Map(list).size,
  text: list => String(list),
  json: list => JSON.stringify(list),
  ownKeys: list => Object.keys(list),
  changedWhileWalked(list) {
    const seen = [];
    for (const [key] of list) {
      seen.push(key);
      if (seen.length === 1) list.delete("c");
      if (seen.length > 5) break;
    }
    return seen;
  },
  grownWhileWalked(list) {
    const seen = [];
    for (const [key] of list) {
      seen.push(key);
      if (seen.length === 1) list.append("y", "25");
      if (seen.length > 5) break;
    }
    return seen;
  },
};

function form() {
  const data = new FormData();
  data.append("b", "2");
  data.append("a", "1");
  data.append("c", "3");
  data.append("b", "22");
  return data;
}

const makers = {
  "an array of pairs": () => [["b", "2"], ["a", "1"], ["c", "3"], ["b", "22"]],
  "a Map": () => new Map([["b", "2"], ["a", "1"], ["c", "3"]]),
  "URLSearchParams": () => new URLSearchParams("b=2&a=1&c=3&b=22"),
  "Headers": () => new Headers([["b", "2"], ["A", "1"], ["c", "3"], ["b", "22"]]),
  "Headers with cookies": () => new Headers([["set-cookie", "x=1"], ["b", "2"], ["set-cookie", "y=2"]]),
  "FormData": form,
  "the search parameters of a URL": () => new URL("http://example.com/?b=2&a=1&c=3").searchParams,
  "a subclass of URLSearchParams": () => new (class extends URLSearchParams { *[Symbol.iterator]() { yield ["own", "iterator"]; } forEach(visit) { visit("own", "forEach", this); } })("b=2"),
  "a subclass of Headers": () => new (class extends Headers { keys() { return ["own keys"].values(); } })({ b: "2" }),
};

for (const use in uses) {
  for (let i = 0; i < 500; i++) {
    try {
      uses[use]([["b", "2"], ["a", "1"], ["c", "3"]]);
    } catch {}
  }
}

for (const name in makers) for (const use in uses) attempt(name + ", " + use, () => uses[use](makers[name]()));
