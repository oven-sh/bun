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

function number(result, change) {
  return {
    valueOf() {
      change();
      return result;
    },
  };
}

function text(result, change) {
  return {
    toString() {
      change();
      return result;
    },
  };
}

const uses = {
  "slice(start)": (list, change) => list.slice(number(1, change)),
  "slice(0, end)": (list, change) => list.slice(0, number(5, change)),
  "splice(start, 1)": (list, change) => list.splice(number(1, change), 1),
  "splice(1, count)": (list, change) => list.splice(1, number(3, change)),
  "fill(0, start)": (list, change) => list.fill(0, number(1, change)),
  "fill(0, 0, end)": (list, change) => list.fill(0, 0, number(5, change)),
  "copyWithin(target)": (list, change) => list.copyWithin(number(0, change), 3),
  "indexOf(6, from)": (list, change) => list.indexOf(6, number(1, change)),
  "lastIndexOf(6, from)": (list, change) => list.lastIndexOf(6, number(5, change)),
  "includes(undefined, from)": (list, change) => list.includes(undefined, number(1, change)),
  "at(index)": (list, change) => list.at(number(4, change)),
  "with(index)": (list, change) => list.with(number(4, change), "w"),
  "toSpliced(start)": (list, change) => list.toSpliced(number(1, change), 1),
  "flat(depth)": (list, change) => list.flat(number(1, change)),
  "join(separator)": (list, change) => list.join(text("-", change)),
  "list[key]": (list, change) => list[text("4", change)],
  "list[key] = value": (list, change) => { list[text("4", change)] = "stored"; return list.length; },
  "length = value": (list, change) => { list.length = number(4, change); return list.length; },
  "key in list": (list, change) => text("4", change) in list,
  "delete list[key]": (list, change) => delete list[text("4", change)],
  "push(value) then read": (list, change) => [list.push(number(1, change)), list.length],
  "concat(spreadable)": (list, change) => list.concat({ get [Symbol.isConcatSpreadable]() { change(); return true; }, length: 1, 0: "spread" }),
};

const changes = {
  "shrinks it": list => { list.length = 2; },
  "empties it": list => { list.length = 0; },
  "grows it": list => { for (let i = 0; i < 50; i++) list.push(7); },
  "turns it into doubles": list => { list[0] = 0.5; },
  "turns it into strings": list => { list[0] = "s"; },
  "deletes an element": list => { delete list[4]; },
  "freezes it": list => { Object.freeze(list); },
  "makes it sparse": list => { list[40000] = 1; list.length = 6; },
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([1, 2, 3, 4, 5, 6], () => {});

for (const use in uses) {
  for (const name in changes) {
    const list = [1, 2, 3, 4, 5, 6];
    attempt(use + ", the argument " + name, () => {
      const result = uses[use](list, () => changes[name](list));
      return Array.isArray(result) ? result.map(value => (typeof value === "object" ? "an object" : value)) : result;
    });
    console.log("  left: " + describe(list.map(value => (typeof value === "object" ? "an object" : value))) + ", length " + list.length);
  }
}
