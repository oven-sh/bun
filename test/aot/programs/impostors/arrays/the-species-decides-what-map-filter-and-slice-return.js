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

function Plain(length) {
  log.push("Plain(" + describe(length) + ")");
  this.made = "by Plain";
}

class ToArray extends Array {
  static get [Symbol.species]() {
    log.push("species read");
    return Array;
  }
}

class ToPlain extends Array {
  static get [Symbol.species]() {
    return Plain;
  }
}

class ToUndefined extends Array {
  static get [Symbol.species]() {
    return undefined;
  }
}

class ToNull extends Array {
  static get [Symbol.species]() {
    return null;
  }
}

class ToANumber extends Array {
  static get [Symbol.species]() {
    return 5;
  }
}

class Padded extends Array {
  constructor(...values) {
    super(...values);
    log.push("Padded(" + values.map(describe).join(", ") + ")");
    this.push("pad");
  }
}

class ToFrozen extends Array {
  static get [Symbol.species]() {
    return function (length) {
      return Object.freeze(new Array(length));
    };
  }
}

class ToTyped extends Array {
  static get [Symbol.species]() {
    return Uint8Array;
  }
}

const makers = {
  "a species of Array": () => ToArray.of(300, 1, 2),
  "a species that makes objects": () => ToPlain.of(300, 1, 2),
  "a species of undefined": () => ToUndefined.of(300, 1, 2),
  "a species of null": () => ToNull.of(300, 1, 2),
  "a species of 5": () => ToANumber.of(300, 1, 2),
  "a constructor that pads": () => { const list = new Padded(); list.length = 0; list.push(300, 1, 2); log.length = 0; return list; },
  "a species that makes frozen arrays": () => ToFrozen.of(300, 1, 2),
  "a species of Uint8Array": () => ToTyped.of(300, 1, 2),
  "a plain array with its own constructor": () => Object.assign([300, 1, 2], { constructor: { [Symbol.species]: Plain } }),
  "a plain array whose constructor is undefined": () => Object.assign([300, 1, 2], { constructor: undefined }),
  "a plain array whose constructor is a number": () => Object.assign([300, 1, 2], { constructor: 5 }),
  "a plain array whose constructor is Plain": () => Object.assign([300, 1, 2], { constructor: Plain }),
  "a plain array whose constructor is read by a getter": () => Object.defineProperty([300, 1, 2], "constructor", { get() { log.push("constructor read"); return Array; } }),
  "an array": () => [300, 1, 2],
};

const uses = {
  map: list => list.map(value => value + 1),
  filter: list => list.filter(value => value > 1),
  slice: list => list.slice(1),
  splice: list => list.splice(0, 2),
  concat: list => list.concat([7]),
  flat: list => list.flat(),
  flatMap: list => list.flatMap(value => [value]),
  toSorted: list => list.toSorted(),
  from: list => Array.from(list),
  spread: list => [...list],
};

function round(title) {
  for (const name in makers) {
    for (const use in uses) {
      log.length = 0;
      const list = makers[name]();
      attempt(title + ", " + use + ", " + name, () => uses[use](list));
      if (log.length) console.log("  log: " + log.join(", "));
    }
  }
}

round("at first");
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([300, 1, 2]);
round("after 2000 arrays");
