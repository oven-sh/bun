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
  "x % 0": x => (x | 0) % 0,
  "x % -0": x => (x | 0) % -0,
  "x % 1": x => (x | 0) % 1,
  "x % -1": x => (x | 0) % -1,
  "x % 2": x => (x | 0) % 2,
  "x % -2": x => (x | 0) % -2,
  "x % 3": x => (x | 0) % 3,
  "x % 10": x => (x | 0) % 10,
  "x % 16": x => (x | 0) % 16,
  "x % 2147483647": x => (x | 0) % 2147483647,
  "x % -2147483648": x => (x | 0) % -2147483648,
  "x % 2147483648": x => (x | 0) % 2147483648,
  "x % 4294967296": x => (x | 0) % 4294967296,
  "x % 0.5": x => (x | 0) % 0.5,
  "x % Infinity": x => (x | 0) % Infinity,
  "(x % 0) | 0": x => ((x | 0) % 0) | 0,
  "(x % 3) | 0": x => ((x | 0) % 3) | 0,
  "(x % -1) | 0": x => ((x | 0) % -1) | 0,
  "unsigned x % 3": x => (x >>> 0) % 3,
  "unsigned x % 4294967295": x => (x >>> 0) % 4294967295,
  "10 % x": x => 10 % (x | 0),
  "-10 % x": x => -10 % (x | 0),
  "0 % x": x => 0 % (x | 0),
  "x / 0": x => (x | 0) / 0,
  "x / -0": x => (x | 0) / -0,
  "x / 1": x => (x | 0) / 1,
  "x / -1": x => (x | 0) / -1,
  "x / 2": x => (x | 0) / 2,
  "x / 4": x => (x | 0) / 4,
  "x / 3": x => (x | 0) / 3,
  "(x / 0) | 0": x => ((x | 0) / 0) | 0,
  "(x / -1) | 0": x => ((x | 0) / -1) | 0,
  "(x / 2) | 0": x => ((x | 0) / 2) | 0,
  "(x / -2) | 0": x => ((x | 0) / -2) | 0,
  "(x / 3) | 0": x => ((x | 0) / 3) | 0,
  "(x / 10) >>> 0": x => ((x | 0) / 10) >>> 0,
  "10 / x": x => 10 / (x | 0),
  "0 / x": x => 0 / (x | 0),
  "(10 / x) | 0": x => (10 / (x | 0)) | 0,
  "x * 0": x => (x | 0) * 0,
  "x * -1": x => (x | 0) * -1,
  "x * 2": x => (x | 0) * 2,
  "x * 65536": x => (x | 0) * 65536,
  "x * 4294967296": x => (x | 0) * 4294967296,
  "x * 0.5": x => (x | 0) * 0.5,
};

const values = [0, 1, -1, 2, -2, 3, -3, 7, -7, 10, -10, 16, -16, 2147483647, -2147483647, -2147483648];
for (const name of Object.keys(uses)) for (let i = 1; i < 500; i++) uses[name](i);
for (const name of Object.keys(uses)) attempt(name, () => values.map(uses[name]));
