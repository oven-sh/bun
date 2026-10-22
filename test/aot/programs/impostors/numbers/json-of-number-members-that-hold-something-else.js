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

function point(x, y) {
  return { x, y };
}

function serialize(x, y) {
  return JSON.stringify(point(x, y));
}

function serializeList(list) {
  return JSON.stringify(list);
}

class Reading {
  constructor(value) {
    this.value = value;
    this.unit = "m";
  }
}

function serializeReading(value) {
  return JSON.stringify(new Reading(value));
}

function serializeNested(value) {
  return JSON.stringify({ id: 1, inner: { value, list: [1, value, 3] } });
}

function roundTrip(value) {
  return JSON.parse(JSON.stringify({ value })).value;
}

for (let i = 0; i < 2000; i++) {
  serialize(i, i + 1);
  serializeList([i, 1, 2]);
  serializeReading(i);
  serializeNested(i);
  roundTrip(i);
}

const values = [5, -5, 0, -0, 0.5, 1e21, 1e-7, 2147483648, -2147483649, 9007199254740993, NaN, Infinity, -Infinity, "5", "", null, undefined, true, 5n, [5], {}, new Number(5), new Number(NaN), new String("5"), new Boolean(false), Object(5n), new Date(0), new Date(NaN), () => 5, Symbol("s"), { toJSON: () => 7 }, { toJSON: () => undefined }, { valueOf: () => 7 }, new Map([[1, 2]]), new Uint8Array([1, 2])];
for (const value of values) {
  const label = show(value);
  attempt("serialize(" + label + ", 1)", () => serialize(value, 1));
  attempt("serializeList with " + label, () => serializeList([1, value, 3]));
  attempt("serializeReading(" + label + ")", () => serializeReading(value));
  attempt("serializeNested(" + label + ")", () => serializeNested(value));
  attempt("roundTrip(" + label + ")", () => roundTrip(value));
}
attempt("a hole", () => serializeList([1, , 3]));
attempt("a getter", () => JSON.stringify({ get n() { return 1.5; } }));
attempt("indentation that is not a number", () => [JSON.stringify([1], null, "2"), JSON.stringify([1], null, 2.9), JSON.stringify([1], null, -1), JSON.stringify([1], null, new Number(1)), JSON.stringify([1], null, 100).length, JSON.stringify([1], null, NaN)]);
attempt("honest calls afterwards", () => [serialize(1, 2), serializeList([1, 2, 3]), serializeReading(1), serializeNested(1), roundTrip(1)]);
