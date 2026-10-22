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
  "list[value]": value => list[value],
  "value in list": value => value in list,
  "template": value => `${value}`,
  "String(value)": value => String(value),
  "Number(value)": value => Number(value),
  "Math.abs(value)": value => Math.abs(value),
  "Math.max(1, value)": value => Math.max(1, value),
  "isNaN(value)": value => isNaN(value),
  "Number.isNaN(value)": value => Number.isNaN(value),
  "parseInt(value)": value => parseInt(value),
  "list.at(value)": value => list.at(value),
  "list.slice(value)": value => list.slice(value),
  "list.indexOf(value)": value => list.indexOf(value),
  "Array(value).length": value => Array(value).length,
  "'a'.repeat(value)": value => "a".repeat(value),
  "'a'.charAt(value)": value => "a".charAt(value),
  "new Date(value)": value => new Date(value),
  "typed array store": value => {
    const array = new Float64Array(1);
    array[0] = value;
    return array[0];
  },
  "switch": value => {
    switch (value) {
      case 1:
        return "one";
      default:
        return "none";
    }
  },
  "loop bound": value => {
    let count = 0;
    for (let i = 0; i < value; i++) count++;
    return count;
  },
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
