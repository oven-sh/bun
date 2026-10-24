function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const list = [1, 2, 3];
const uses = {
  "value - 1": value => value - 1,
  "value + 1": value => value + 1,
  "value + ''": value => value + "",
  "+value": value => +value,
  "-value": value => -value,
  "~value": value => ~value,
  "value | 0": value => value | 0,
  "value >>> 0": value => value >>> 0,
  "value ** 2": value => value ** 2,
  "value++": value => value++,
  "value += 1": value => (value += 1),
  "value < 1": value => value < 1,
  "value >= 1": value => value >= 1,
  "value == 1": value => value == 1,
  "value === 1": value => value === 1,
  "value != 1": value => value != 1,
  "!value": value => !value,
  "value ? 1 : 2": value => (value ? 1 : 2),
  "value || 1": value => typeof (value || 1),
  "typeof value": value => typeof value,
};

const symbols = {
  "a symbol": () => Symbol("s"),
  "a registered symbol": () => Symbol.for("s"),
  "a well-known symbol": () => Symbol.iterator,
  "a symbol object": () => Object(Symbol("s")),
  "an object that converts to a symbol": () => ({ valueOf: () => Symbol("s") }),
};

for (const kind of Object.keys(symbols)) for (const name of Object.keys(uses)) attempt("cold " + name + " of " + kind, () => uses[name](symbols[kind]()));
for (const name of Object.keys(uses)) for (let i = 0; i < 2000; i++) uses[name](i % 3);
for (const kind of Object.keys(symbols)) for (const name of Object.keys(uses)) attempt("warm " + name + " of " + kind, () => uses[name](symbols[kind]()));
for (const name of Object.keys(uses)) attempt(name + " of 1", () => uses[name](1));
