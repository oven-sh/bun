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

function sizeOf(config) {
  return config.name.length;
}

function shout(config) {
  return config.name.toUpperCase();
}

function greeting(config) {
  return "hello " + config.name;
}

function isAda(config) {
  return config.name === "ada";
}

function check(label, change) {
  let config = { name: "ada", port: 80 };
  let outcome = "";
  try {
    config = change(config) || config;
  } catch (error) {
    outcome = " (the store threw " + error.constructor.name + ")";
  }
  const parts = [];
  for (const use of [sizeOf, shout, greeting, isAda]) {
    try {
      parts.push(show(use(config)));
    } catch (error) {
      parts.push("threw " + error.constructor.name);
    }
  }
  console.log(label + outcome + " -> " + parts.join(" | ") + " | keys " + Object.keys(config).join(","));
}

for (let i = 0; i < 2000; i++) {
  const config = { name: "ada", port: 80 };
  sizeOf(config);
  shout(config);
  greeting(config);
  isAda(config);
}

const five = make("5");
const list = make("['a', 'd', 'a']");
const key = make("'na' + 'me'");

check("nothing is changed", () => {});
check("a plain store", config => { config.name = five; });
check("a store by a computed name", config => { config[key] = five; });
check("a store by a literal text", config => { config["name"] = list; });
check("Reflect.set", config => { Reflect.set(config, "name", five); });
check("Reflect.set with another receiver", config => { Reflect.set({}, "name", five, config); });
check("Object.assign", config => { Object.assign(config, { name: five }); });
check("Object.assign from JSON", config => { Object.assign(config, JSON.parse('{ "name": ["j"] }')); });
check("Object.assign from a text", config => { Object.assign(config, "xy"); });
check("defineProperty", config => { Object.defineProperty(config, "name", { value: five }); });
check("defineProperties", config => { Object.defineProperties(config, { name: { value: list } }); });
check("a getter", config => { Object.defineProperty(config, "name", { get: () => five }); });
check("__defineGetter__", config => { config.__defineGetter__("name", () => list); });
check("an object pattern", config => { ({ a: config.name } = { a: five }); });
check("a list pattern", config => { [config.name] = [five]; });
check("a pattern with a default", config => { ({ a: config.name = five } = {}); });
check("a rest pattern", config => { [...config.name] = "ada"; });
check("a for-of head", config => { for (config.name of [five]); });
check("a for-in head", config => { for (config.name in { key: 1 }); });
check("an update", config => { config.name++; });
check("a compound store with a number", config => { config.name += five; });
check("a compound store that makes a number", config => { config.name *= 2; });
check("a logical store that does nothing", config => { config.name ||= five; });
check("a logical store that stores", config => { config.name &&= five; });
check("entries of another object", config => { Object.entries({ name: five, extra: 1 }).forEach(([name, value]) => { config[name] = value; }); });
check("for-in over another object", config => { const other = { name: list }; for (const name in other) config[name] = other[name]; });
check("delete", config => { delete config.name; });
check("delete, then inherit", config => { delete config.name; Object.setPrototypeOf(config, { name: five }); });
check("delete, then store again", config => { delete config.name; config.name = "ada"; });
check("a copy by spread with an override", config => ({ ...config, name: five }));
check("a copy by spread of two", config => ({ ...config, ...{ name: list } }));
check("a copy by Object.create", config => Object.create(config, { name: { value: five, enumerable: true } }));
check("a copy by structuredClone after a store", config => { config.name = new String("ada"); return structuredClone(config); });
check("a copy by JSON after a store", config => { config.name = new String("ada"); return JSON.parse(JSON.stringify(config)); });
check("a copy by fromEntries", config => Object.fromEntries(Object.entries(config).map(([name, value]) => [name, name === "name" ? five : value])));
check("another object of the same shape", () => ({ name: five, port: 80 }));
check("another object with the members in another order", () => ({ port: 80, name: list }));
check("another object from eval", () => make("{ name: 5, port: 80 }"));
check("another object that is a class instance", () => new (class { name = five; port = 80; })());
check("another object that is a list", () => Object.assign([], { name: five }));
check("another object that is a function", () => function ada() {});
check("another object that is a Proxy", config => new Proxy(config, { get: (target, name) => (name === "name" ? five : target[name]) }));
check("through an alias", config => { const alias = config; alias.name = five; });
check("through a closure", config => { (() => { config.name = five; })(); });
check("through eval", config => { globalThis.configForEval = config; (0, eval)("configForEval.name = 5"); delete globalThis.configForEval; });
check("through new Function", config => { new Function("config", "config.name = [1, 2]")(config); });
check("through a conversion", config => { `${{ toString() { config.name = five; return ""; } }}`; });
check("through a setter on the prototype", config => { delete config.name; Object.setPrototypeOf(config, { set name(value) { Object.defineProperty(this, "name", { value: five, enumerable: true }); } }); config.name = "ada"; });
check("frozen first", config => { Object.freeze(config); config.name = five; });
check("not writable first", config => { Object.defineProperty(config, "name", { writable: false }); config.name = five; });
check("a wrapped text", config => { config.name = new String("ada"); });
check("a text built at run time", config => { config.name = "a" + make("'da'"); });
check("null", config => { config.name = null; });
check("undefined", config => { config.name = undefined; });
check("a symbol", config => { config.name = Symbol("ada"); });
