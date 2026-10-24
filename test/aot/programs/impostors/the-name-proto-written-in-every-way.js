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

const parent = { inherited: "from the parent" };

function describe(object) {
  return [Reflect.ownKeys(object).join(" "), Object.getPrototypeOf(object) === parent ? "parent" : Object.getPrototypeOf(object) === Object.prototype ? "Object.prototype" : Object.getPrototypeOf(object) === null ? "null" : "other", object.inherited];
}

function storeByKey(object, key, value) {
  object[key] = value;
  return object;
}

function readByKey(object, key) {
  return object[key];
}

function literalWithKey(key, value) {
  return { [key]: value };
}

for (let i = 0; i < 2000; i++) {
  storeByKey({}, "name", parent);
  readByKey({ name: 1 }, "name");
  literalWithKey("name", parent);
}

const name = make("'__pro' + 'to__'");
const __proto__ = parent;

attempt("written as a name in a literal", () => describe({ __proto__: parent }));
attempt("written as a text in a literal", () => describe({ "__proto__": parent }));
attempt("computed from a literal text", () => describe({ ["__proto__"]: parent }));
attempt("computed from a variable", () => describe({ [name]: parent }));
attempt("computed in a function", () => describe(literalWithKey(name, parent)));
attempt("shorthand", () => describe({ __proto__ }));
attempt("a method", () => describe({ __proto__() {} }));
attempt("an accessor", () => describe({ get __proto__() { return parent; } }));
attempt("a name in a literal, not an object", () => describe({ __proto__: 5 }));
attempt("a name in a literal, null", () => describe({ __proto__: null }));
attempt("a name in a literal, a text", () => describe({ __proto__: "text" }));
attempt("a name in a literal, undefined", () => describe({ __proto__: undefined }));
attempt("spread of an object that owns it", () => describe({ ...literalWithKey(name, parent) }));
attempt("Object.assign of an object that owns it", () => describe(Object.assign({}, literalWithKey(name, parent))));
attempt("JSON.parse", () => describe(JSON.parse('{ "__proto__": { "inherited": "from JSON" } }')));
attempt("JSON.parse and then Object.assign", () => describe(Object.assign({}, JSON.parse('{ "__proto__": { "inherited": "from JSON" } }'))));
attempt("Object.fromEntries", () => describe(Object.fromEntries([[name, parent]])));
attempt("a store by name", () => {
  const object = {};
  object.__proto__ = parent;
  return describe(object);
});
attempt("a store by key", () => describe(storeByKey({}, name, parent)));
attempt("a store by key of a number", () => describe(storeByKey({}, name, 5)));
attempt("a store by key of null", () => describe(storeByKey({}, name, null)));
attempt("a store by key into an object without a prototype", () => describe(storeByKey(Object.create(null), name, parent)));
attempt("a store by key into a list", () => {
  const list = storeByKey([1], name, parent);
  return [Array.isArray(list), list.inherited, typeof list.push, list.length];
});
attempt("a store by key into an object that cannot be extended", () => describe(storeByKey(Object.preventExtensions({}), name, parent)));
attempt("a store by key that would make a cycle", () => {
  const child = Object.create(parent);
  try {
    return describe(storeByKey(parent, name, child));
  } finally {
    Object.setPrototypeOf(parent, Object.prototype);
  }
});
attempt("a store by key into a text", () => storeByKey("text", name, parent));
attempt("a read by key", () => [readByKey({}, name) === Object.prototype, readByKey([], name) === Array.prototype, readByKey("", name) === String.prototype, readByKey(5, name) === Number.prototype, readByKey(Object.create(null), name)]);
attempt("a read by key of null", () => readByKey(null, name));
attempt("in and own", () => [name in {}, Object.hasOwn({}, name), name in Object.create(null), Object.hasOwn(literalWithKey(name, 1), name)]);
attempt("delete by key", () => {
  const object = literalWithKey(name, parent);
  const answer = delete object[name];
  return [answer, describe(object)];
});
attempt("a class member", () => {
  class Odd {
    __proto__ = "a field";
    static __proto__ = "a static field";
  }
  return [Reflect.ownKeys(new Odd()), Object.hasOwn(Odd, name), Object.getPrototypeOf(Odd) === Function.prototype];
});
attempt("destructured", () => {
  const { __proto__: first } = {};
  const { [name]: second } = literalWithKey(name, "own");
  return [first === Object.prototype, second];
});
attempt("a word count", () => {
  const counts = {};
  for (const word of ["a", name, "constructor", "a", name, "constructor", "toString"]) counts[word] = (counts[word] || 0) + 1;
  return [Object.keys(counts), counts.a, typeof counts.constructor, typeof counts.toString, Object.getPrototypeOf(counts) === Object.prototype];
});
