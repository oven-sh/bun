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

function sumOf(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) total += items[i];
  return total;
}

function OldStack() {
  this.items = [3, 1, 2];
}
OldStack.prototype.add = function (value) {
  return this.items.push(value);
};
OldStack.prototype.total = function () {
  return sumOf(this.items);
};
OldStack.prototype.walk = function () {
  const seen = [];
  for (const value of this.items) seen.push(value);
  return seen;
};
OldStack.prototype.replace = function (value) {
  this.items = value;
};

function literal() {
  return {
    items: [3, 1, 2],
    add(value) {
      return this.items.push(value);
    },
    total() {
      return sumOf(this.items);
    },
    walk() {
      const seen = [];
      for (const value of this.items) seen.push(value);
      return seen;
    },
    replace(value) {
      this.items = value;
    },
  };
}

function closure() {
  let items = [3, 1, 2];
  return {
    add: value => items.push(value),
    total: () => sumOf(items),
    walk() {
      const seen = [];
      for (const value of items) seen.push(value);
      return seen;
    },
    replace(value) {
      items = value;
    },
  };
}

class Private {
  #items = [3, 1, 2];
  add(value) {
    return this.#items.push(value);
  }
  total() {
    return sumOf(this.#items);
  }
  walk() {
    const seen = [];
    for (const value of this.#items) seen.push(value);
    return seen;
  }
  replace(value) {
    this.#items = value;
  }
}

class Static {
  static items = [3, 1, 2];
  static add(value) {
    return Static.items.push(value);
  }
  static total() {
    return sumOf(Static.items);
  }
  static walk() {
    const seen = [];
    for (const value of Static.items) seen.push(value);
    return seen;
  }
  static replace(value) {
    Static.items = value;
  }
}

let shared = [3, 1, 2];
const moduleLevel = {
  add: value => shared.push(value),
  total: () => sumOf(shared),
  walk() {
    const seen = [];
    for (const value of shared) seen.push(value);
    return seen;
  },
  replace(value) {
    shared = value;
  },
};

function inAMap() {
  const held = new Map([["items", [3, 1, 2]]]);
  return {
    add: value => held.get("items").push(value),
    total: () => sumOf(held.get("items")),
    walk() {
      const seen = [];
      for (const value of held.get("items")) seen.push(value);
      return seen;
    },
    replace(value) {
      held.set("items", value);
    },
  };
}

function inAnArray() {
  const held = [[3, 1, 2]];
  return {
    add: value => held[0].push(value),
    total: () => sumOf(held[0]),
    walk() {
      const seen = [];
      for (const value of held[0]) seen.push(value);
      return seen;
    },
    replace(value) {
      held[0] = value;
    },
  };
}

const holders = {
  "an old-style object": () => new OldStack(),
  "an object literal": literal,
  "a closure": closure,
  "a private field": () => new Private(),
  "a static field": () => (Static.replace([3, 1, 2]), Static),
  "a variable of the module": () => (moduleLevel.replace([3, 1, 2]), moduleLevel),
  "a Map": inAMap,
  "an array": inAnArray,
};

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const impostors = {
  "an array-like from JSON": () => JSON.parse('{"0":7,"1":8,"length":2}'),
  "a subclass": () => Loud.of(7, 8),
  "a string": () => "78",
  "a Set": () => new Set([7, 8]),
  "a typed array": () => new Uint8Array([200, 100]),
  "a frozen array": () => Object.freeze([7, 8]),
  "doubles": () => [7.5, 8.5],
  "an array with a hole": () => [7, , 8],
  "a proxy": () => new Proxy([7, 8], {}),
  "null": () => null,
  "another array": () => [7, 8],
};

for (const kind in holders) {
  for (let i = 0; i < 1000; i++) {
    const holder = holders[kind]();
    holder.add(9);
    holder.total();
    holder.walk();
    holder.replace([1, 2]);
    holder.total();
  }
}

const calls = {
  total: holder => holder.total(),
  walk: holder => holder.walk(),
  add: holder => holder.add(9),
};

for (const kind in holders) {
  for (const name in impostors) {
    const answers = [];
    for (const call in calls) {
      const holder = holders[kind]();
      holder.replace(impostors[name]());
      try {
        answers.push(call + " " + describe(calls[call](holder)));
      } catch (error) {
        answers.push(call + " threw " + error.constructor.name);
      }
    }
    console.log(kind + ", " + name + ": " + answers.join("; "));
  }
  const honest = holders[kind]();
  console.log(kind + ", a fresh one afterwards: " + describe([honest.total(), honest.walk(), honest.add(9)]));
}
