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

const uses = {
  "ceil - 1": x => Math.ceil(x) - 1,
  "x | 0": x => x | 0,
  "~~x": x => ~~x,
  "x - x % 1": x => x - (x % 1),
  "floor as an index": x => ["a", "b", "c"][Math.floor(x)],
  "floor of a half": x => Math.floor(x / 2),
  "round of a product": x => Math.round(x * 100) / 100,
};

const values = [0, -0, 0.4, -0.4, 0.5, -0.5, 0.49999999999999994, -0.49999999999999994, 0.9, -0.9, 1.5, -1.5, 2.5, -2.5, 1.005, 2147483646.5, 2147483647, 2147483647.4, 2147483647.5, 2147483648, -2147483648, -2147483648.4, -2147483648.5, -2147483649, 4294967295.5, 4294967296.5, 4503599627370495.5, 4503599627370496.5, 9007199254740991, 9007199254740992, 1e21, -1e21, 5e-324, -5e-324, Infinity, -Infinity, NaN];

for (const name of Object.keys(uses)) for (let i = 0; i < 1000; i++) uses[name](i + 0.25);
for (const name of Object.keys(uses)) for (const value of values) attempt(name + " of " + show(value), () => uses[name](value));
