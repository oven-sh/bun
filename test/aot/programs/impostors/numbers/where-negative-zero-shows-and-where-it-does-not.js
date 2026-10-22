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

function negativeZero(a, b) {
  return (a | 0) * (b | 0);
}

for (let i = 1; i < 2000; i++) negativeZero(i, i);
const z = negativeZero(0, -1);

attempt("show", () => z);
attempt("Object.is(z, -0)", () => Object.is(z, -0));
attempt("z === 0", () => z === 0);
attempt("z == 0", () => z == 0);
attempt("z < 0", () => z < 0);
attempt("z >= 0", () => z >= 0);
attempt("1 / z", () => 1 / z);
attempt("z + 0", () => z + 0);
attempt("z - 0", () => z - 0);
attempt("z * 1", () => z * 1);
attempt("z + z", () => z + z);
attempt("-z", () => -z);
attempt("+z", () => +z);
attempt("z | 0", () => z | 0);
attempt("String(z)", () => String(z));
attempt("template", () => `${z}`);
attempt("z + ''", () => z + "");
attempt("z.toString()", () => z.toString());
attempt("z.toFixed(1)", () => z.toFixed(1));
attempt("z.toLocaleString()", () => z.toLocaleString("en-US"));
attempt("JSON.stringify(z)", () => JSON.stringify(z));
attempt("JSON.stringify([z])", () => JSON.stringify([z]));
attempt("JSON.stringify({ z })", () => JSON.stringify({ z }));
attempt("[z].join()", () => [z].join());
attempt("[z]", () => [z]);
attempt("[z][0]", () => [z][0]);
attempt("[1, 2, 3].fill(z)", () => [1, 2, 3].fill(z));
attempt("[0].indexOf(z)", () => [0].indexOf(z));
attempt("[0].includes(z)", () => [0].includes(z));
attempt("[z].indexOf(0)", () => [z].indexOf(0));
attempt("[z].includes(0)", () => [z].includes(0));
attempt("[z].findIndex(is -0)", () => [0, z].findIndex(x => Object.is(x, -0)));
attempt("['a', 'b'][z]", () => ["a", "b"][z]);
attempt("'ab'[z]", () => "ab"[z]);
attempt("'ab'.at(z)", () => "ab".at(z));
attempt("Object.keys({ [z]: 1 })", () => Object.keys({ [z]: 1 }));
attempt("a Map key", () => {
  const map = new Map([[z, "stored under -0"]]);
  return [map.get(0), map.get(-0), [...map.keys()]];
});
attempt("a Map that has 0", () => {
  const map = new Map([[0, "stored under 0"]]);
  map.set(z, "overwritten");
  return [map.size, map.get(0), [...map.keys()]];
});
attempt("a Set", () => [...new Set([z])]);
attempt("a Set of both", () => [...new Set([0, z])]);
attempt("a field", () => ({ z }).z);
attempt("a field that held integers", () => {
  const holder = { n: 1 };
  for (let i = 0; i < 100; i++) holder.n = i;
  holder.n = z;
  return holder.n;
});
attempt("an element of an array of integers", () => {
  const list = [1, 2, 3];
  list[1] = z;
  return list;
});
attempt("pushed to an array of integers", () => {
  const list = [1, 2, 3];
  list.push(z);
  return list;
});
attempt("Int32Array", () => new Int32Array([z])[0]);
attempt("Float64Array", () => new Float64Array([z])[0]);
attempt("Float32Array", () => new Float32Array([z])[0]);
attempt("Math.min(z, 0)", () => Math.min(z, 0));
attempt("Math.max(z, 0)", () => Math.max(z, 0));
attempt("Math.min(0, z)", () => Math.min(0, z));
attempt("Math.max(0, z)", () => Math.max(0, z));
attempt("Math.round(z)", () => Math.round(z));
attempt("Math.floor(z)", () => Math.floor(z));
attempt("Math.abs(z)", () => Math.abs(z));
attempt("Math.sign(z)", () => Math.sign(z));
attempt("Math.atan2(z, z)", () => Math.atan2(z, z));
attempt("Math.atan2(z, 0)", () => Math.atan2(z, 0));
attempt("Math.hypot(z)", () => Math.hypot(z));
attempt("Math.cbrt(z)", () => Math.cbrt(z));
attempt("Math.fround(z)", () => Math.fround(z));
attempt("Math.pow(z, -1)", () => Math.pow(z, -1));
attempt("z ** -1", () => z ** -1);
attempt("z % 5", () => z % 5);
attempt("5 % z", () => 5 % z);
attempt("z / 5", () => z / 5);
attempt("z ? 1 : 2", () => (z ? 1 : 2));
attempt("z || 'falsy'", () => z || "falsy");
attempt("z ?? 'nullish'", () => z ?? "nullish");
attempt("switch", () => {
  switch (z) {
    case 0:
      return "case 0";
    default:
      return "default";
  }
});
attempt("sorted", () => [0, z, 0, z].sort((a, b) => a - b));
attempt("sorted by default", () => [1, z, 0].sort());
attempt("returned through a closure", () => (() => z)());
attempt("through a default parameter", () => ((n = 1) => n)(z));
attempt("spread", () => Math.min(...[z, 0]));
attempt("destructured", () => {
  const [first] = [z];
  const { n } = { n: z };
  return [first, n];
});
attempt("structuredClone", () => structuredClone(z));
attempt("Number.isInteger(z)", () => Number.isInteger(z));
attempt("BigInt(z)", () => BigInt(z));
attempt("z.toString(2)", () => z.toString(2));
attempt("z.toExponential()", () => z.toExponential());
attempt("z.toPrecision(2)", () => z.toPrecision(2));
attempt("new Date(z).getTime()", () => new Date(z).getTime());
attempt("Array(z)", () => Array(z));
attempt("'a'.repeat(z)", () => "a".repeat(z));
