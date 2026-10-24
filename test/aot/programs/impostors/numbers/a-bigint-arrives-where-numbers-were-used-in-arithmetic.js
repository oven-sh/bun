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

const list = ["zero", "one", "two", "three"];
const uses = {
  "value - 1": value => value - 1,
  "value + 1": value => value + 1,
  "value * 2": value => value * 2,
  "value / 2": value => value / 2,
  "value % 2": value => value % 2,
  "value ** 2": value => value ** 2,
  "value + ''": value => value + "",
  "value + '1'": value => value + "1",
  "value - value": value => value - value,
  "value * value": value => value * value,
  "value / value": value => value / value,
  "value ** value": value => value ** value,
  "+value": value => +value,
  "-value": value => -value,
  "~value": value => ~value,
  "value | 0": value => value | 0,
  "value >>> 0": value => value >>> 0,
  "value >>> value": value => value >>> value,
  "value << value": value => value << value,
  "value >> value": value => value >> value,
  "value & value": value => value & value,
};

const values = { "2n": 2n, "0n": 0n, "-3n": -3n, "Object(2n)": Object(2n), "2": 2 };
for (const kind of Object.keys(values)) for (const name of Object.keys(uses)) attempt("cold " + name + " of " + kind, () => uses[name](values[kind]));
for (const name of Object.keys(uses)) for (let i = 0; i < 2000; i++) outcome(() => uses[name](i % 4));
for (const kind of Object.keys(values)) for (const name of Object.keys(uses)) attempt("warm " + name + " of " + kind, () => uses[name](values[kind]));
