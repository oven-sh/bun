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
  "toString(2)": n => n.toString(2).slice(0, 40),
  "toString(16)": n => n.toString(16).slice(0, 40),
  "toString(36)": n => n.toString(36).slice(0, 40),
  "toFixed(0)": n => n.toFixed(0),
  "toFixed(2)": n => n.toFixed(2),
  "toPrecision(3)": n => n.toPrecision(3),
  "toExponential(2)": n => n.toExponential(2),
  "and back": n => Object.is(Number(String(n)), n),
};

const values = [0, -0, 1, -1, 10, 100, 255, 1000000, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e20, 1e21, 1.5e21, 123456789012345680000, 1e-6, 1e-7, 1.5e-7, 0.1, 0.5, 0.1 + 0.2, 1 / 3, 1.005, 2.5, 1.45, 8.345, 100.5, 5e-324, 1.7976931348623157e308, NaN, Infinity, -Infinity, 0.000001234, 1234.5678, -1234.5678, 4.35, 0.30000000000000004];

for (const name of Object.keys(uses)) for (let i = 0; i < 500; i++) uses[name](i);
for (const name of Object.keys(uses)) for (const value of values) attempt(name + " of " + show(value), () => uses[name](value));
