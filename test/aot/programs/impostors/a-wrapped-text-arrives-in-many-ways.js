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

function inspect(value) {
  let inSwitch;
  switch (value) {
    case "abc":
      inSwitch = "matched";
      break;
    default:
      inSwitch = "default";
  }
  return [typeof value, value.length, value.charCodeAt(0), value === "abc", value == "abc", value + "", { abc: "found" }[value], inSwitch, typeof value === "string" ? "plain" : "not plain", value ? "truthy" : "falsy"].join(" ");
}

for (let i = 0; i < 2000; i++) inspect("abc");
console.log("honest:", inspect("abc"));

async function main() {
  const wrapped = new String("abc");
  attempt("a plain argument", () => inspect(wrapped));
  attempt("direct eval", () => inspect(eval("new String('abc')")));
  attempt("indirect eval", () => inspect((0, eval)("new String('abc')")));
  attempt("new Function", () => inspect(new Function("return new String('abc')")()));
  attempt("new Function that calls back", () => new Function("inspect", "return inspect(Object('abc'))")(inspect));
  attempt("JSON.parse with a reviver", () => inspect(JSON.parse('["abc"]', (key, value) => (typeof value === "string" ? new String(value) : value))[0]));
  attempt("structuredClone", () => inspect(structuredClone(wrapped)));
  attempt("structuredClone of a holder", () => inspect(structuredClone({ deep: [wrapped] }).deep[0]));
  attempt("Object()", () => inspect(Object("abc")));
  attempt("Object.assign into a text", () => inspect(Object.assign("abc", {})));
  attempt("Reflect.construct", () => inspect(Reflect.construct(String, ["abc"])));
  attempt("this of a sloppy function", () => inspect(new Function("return this").call("abc")));
  attempt("a sort comparator", () => {
    let seen;
    [wrapped, new String("abd")].sort((a, b) => { seen = inspect(a) + " | " + inspect(b); return 0; });
    return seen;
  });
  attempt("map", () => [wrapped].map(inspect)[0]);
  attempt("forEach", () => {
    let seen;
    [wrapped].forEach(value => { seen = inspect(value); });
    return seen;
  });
  attempt("reduce", () => [wrapped].reduce((seen, value) => inspect(value), null));
  attempt("find", () => inspect([1, wrapped].find(value => typeof value === "object")));
  attempt("Array.from", () => Array.from([wrapped], inspect)[0]);
  attempt("Reflect.apply", () => Reflect.apply(inspect, null, [wrapped]));
  attempt("call", () => inspect.call(null, wrapped));
  attempt("apply", () => inspect.apply(null, [wrapped]));
  attempt("bind", () => inspect.bind(null, wrapped)());
  attempt("spread", () => inspect(...[wrapped]));
  attempt("arguments", () => (function () { return inspect(arguments[0]); })(wrapped));
  attempt("a rest parameter", () => ((...rest) => inspect(rest[0]))(wrapped));
  attempt("a default", () => ((value = wrapped) => inspect(value))());
  attempt("a pattern", () => (({ value }) => inspect(value))({ value: wrapped }));
  attempt("a computed name", () => inspect({ secret: wrapped }[make("'sec' + 'ret'")]));
  attempt("a getter", () => inspect({ get value() { return wrapped; } }.value));
  attempt("a Proxy", () => inspect(new Proxy({}, { get: () => wrapped }).anything));
  attempt("a Map", () => inspect(new Map([["k", wrapped]]).get("k")));
  attempt("a Set", () => inspect([...new Set([wrapped])][0]));
  attempt("a WeakRef", () => inspect(new WeakRef(wrapped).deref()));
  attempt("a generator", () => inspect((function* () { yield wrapped; })().next().value));
  attempt("sent into a generator", () => {
    const steps = (function* () { return inspect(yield); })();
    steps.next();
    return steps.next(wrapped).value;
  });
  attempt("for-of", () => {
    for (const value of [wrapped]) return inspect(value);
  });
  attempt("thrown and caught", () => {
    try {
      throw wrapped;
    } catch (caught) {
      return inspect(caught);
    }
  });
  attempt("a closure", () => (() => () => inspect(wrapped))()());
  attempt("a class field", () => inspect(new (class { value = wrapped; })().value));
  attempt("a static block", () => {
    let seen;
    class Once { static { seen = inspect(wrapped); } }
    return seen;
  });
  attempt("a conditional", () => inspect(make("true") ? wrapped : "abc"));
  attempt("a logical or", () => inspect(make("''") || wrapped));
  attempt("a comma", () => inspect((0, wrapped)));
  attempt("a tag", () => ((strings, value) => inspect(value))`${wrapped}`);
  attempt("toJSON", () => {
    let seen;
    JSON.stringify({ toJSON() { seen = inspect(wrapped); } });
    return seen;
  });
  attempt("a replace callback's closure", () => "x".replace("x", () => inspect(wrapped)));
  console.log("await -> " + inspect(await wrapped));
  console.log("a promise -> " + inspect(await Promise.resolve(wrapped)));
  console.log("a reaction -> " + (await Promise.resolve(wrapped).then(inspect)));
  console.log("a thenable -> " + inspect(await { then(resolve) { resolve(wrapped); } }));
  console.log("Promise.all -> " + inspect((await Promise.all([wrapped]))[0]));
  console.log("a rejection -> " + (await Promise.reject(wrapped).catch(inspect)));
  console.log("a microtask -> " + (await new Promise(resolve => queueMicrotask(() => resolve(inspect(wrapped))))));
  console.log("a timer -> " + (await new Promise(resolve => setTimeout(value => resolve(inspect(value)), 0, wrapped))));
  for await (const value of [wrapped]) console.log("for await -> " + inspect(value));
  console.log("honest again:", inspect("abc"));
}

await main();
