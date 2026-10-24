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
  "parseInt(value)": value => parseInt(value),
  "Math.abs(value)": value => Math.abs(value),
  "Math.max(value, 1)": value => Math.max(value, 1),
  "isNaN(value)": value => isNaN(value),
  "Number.isInteger(value)": value => Number.isInteger(value),
  "list.at(value)": value => list.at(value),
  "list.slice(value)": value => list.slice(value),
  "[1, 2, 3].indexOf(value)": value => [1, 2, 3].indexOf(value),
  "[1, 2, 3].includes(value)": value => [1, 2, 3].includes(value),
  "Array(value)": value => Array(value),
  "'a'.repeat(value)": value => "a".repeat(value),
  "new Map([[2, 'two']]).get(value)": value => new Map([[2, "two"]]).get(value),
  "Object.keys({ [value]: 0 })": value => Object.keys({ [value]: 0 }),
  "JSON.stringify(value)": value => JSON.stringify(value),
  "Int32Array store": value => {
    const array = new Int32Array(1);
    array[0] = value;
    return array[0];
  },
  "BigInt64Array store": value => {
    const array = new BigInt64Array(1);
    array[0] = value;
    return array[0];
  },
  "switch": value => {
    switch (value) {
      case 2:
        return "the number two";
      case 2n:
        return "the bigint two";
      default:
        return "none";
    }
  },
  "loop bound": value => {
    let count = 0;
    for (let i = 0; i < value; i++) count++;
    return count;
  },
  "loop start": value => {
    const seen = [];
    for (let i = value; i < 5; i++) seen.push(i);
    return seen;
  },
};

const values = { "2n": 2n, "0n": 0n, "-3n": -3n, "Object(2n)": Object(2n), "2": 2 };
for (const kind of Object.keys(values)) for (const name of Object.keys(uses)) attempt("cold " + name + " of " + kind, () => uses[name](values[kind]));
for (const name of Object.keys(uses)) for (let i = 0; i < 2000; i++) outcome(() => uses[name](i % 4));
for (const kind of Object.keys(values)) for (const name of Object.keys(uses)) attempt("warm " + name + " of " + kind, () => uses[name](values[kind]));
