function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const log = [];

function logging(target) {
  return new Proxy(target, {
    get(object, key, receiver) {
      log.push("get " + String(key));
      const found = Reflect.get(object, key, object);
      return typeof found === "function" ? found.bind(object) : found;
    },
    has(object, key) {
      log.push("has " + String(key));
      return Reflect.has(object, key);
    },
    set(object, key, value) {
      log.push("set " + String(key));
      return Reflect.set(object, key, value);
    },
    deleteProperty(object, key) {
      log.push("delete " + String(key));
      return Reflect.deleteProperty(object, key);
    },
    ownKeys(object) {
      log.push("ownKeys");
      return Reflect.ownKeys(object);
    },
    getOwnPropertyDescriptor(object, key) {
      log.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
    getPrototypeOf(object) {
      log.push("getPrototypeOf");
      return Reflect.getPrototypeOf(object);
    },
  });
}

function report(label, run) {
  attempt(label, run);
  console.log("  asked:", log.splice(0).join(", "));
}

function hash(text) {
  let result = 0;
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return result;
}

function elements(text) {
  const seen = [];
  for (let i = 0; i < text.length; i++) seen.push(text[i]);
  return seen;
}

function lengthOnce(text) {
  const seen = [];
  for (let i = 0, length = text.length; i < length; i++) seen.push(text[i]);
  return seen;
}

function label(text) {
  return "<" + text + ">";
}

function template(text) {
  return `<${text}>`;
}

function isAb(text) {
  return text == "ab";
}

function isBeforeB(text) {
  return text < "b";
}

function characters(text) {
  return [...text];
}

function asKey(text) {
  return { ab: "found" }[text];
}

function upperTwice(text) {
  return text.toUpperCase() + text.toUpperCase();
}

function sliceAndLength(text) {
  return text.slice(1).length + text.length;
}

function optional(text) {
  return text?.trim?.();
}

function kind(text) {
  return [typeof text, text instanceof String, Array.isArray(text), Object.prototype.toString.call(text)];
}

function keys(text) {
  const seen = [];
  for (const key in text) seen.push(key);
  return [seen, Object.keys(text), "0" in text, Object.hasOwn(text, "length")];
}

function json(text) {
  return JSON.stringify(text);
}

const uses = [
  ["hash", hash],
  ["elements", elements],
  ["length once", lengthOnce],
  ["label", label],
  ["template", template],
  ["== 'ab'", isAb],
  ["< 'b'", isBeforeB],
  ["characters", characters],
  ["as a key", asKey],
  ["upper twice", upperTwice],
  ["slice and length", sliceAndLength],
  ["optional", optional],
  ["kind", kind],
  ["keys", keys],
  ["JSON", json],
];

for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) {
    if (use !== keys) use("ab");
  }
}

for (const [name, use] of uses) {
  report(name + " of a proxy of a wrapped text", () => use(logging(new String("ab"))));
  report(name + " of a proxy of a list", () => use(logging(["a", "b"])));
  report(name + " of a proxy of a look-alike", () => use(logging({ length: 2, 0: "a", 1: "b", charCodeAt: index => 97 + index, toUpperCase: () => "AB", slice: () => "b", trim: () => "ab", toString: () => "ab" })));
}
