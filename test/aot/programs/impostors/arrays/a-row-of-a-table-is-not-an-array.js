function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function sumOfRows(rows) {
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (let j = 0; j < row.length; j++) total += row[j];
  }
  return total;
}

function sumWithoutALocal(rows) {
  let total = 0;
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows[i].length; j++) total += rows[i][j];
  return total;
}

function walkRows(rows) {
  const seen = [];
  for (const row of rows) for (const cell of row) seen.push(cell);
  return seen;
}

function firstCells(rows) {
  const seen = [];
  for (const [first] of rows) seen.push(first);
  return seen;
}

function widths(rows) {
  return rows.map(row => row.length);
}

function flattened(rows) {
  return rows.flat();
}

function flattenedByConcat(rows) {
  return [].concat(...rows);
}

function flattenedBySpread(rows) {
  const out = [];
  for (const row of rows) out.push(...row);
  return out;
}

function padded(rows) {
  for (const row of rows) row.push(0);
  return rows.map(row => row.length);
}

function transposedFirst(rows) {
  return rows.map(row => row[0]);
}

function sortedRows(rows) {
  return rows.map(row => row.slice().sort((a, b) => a - b));
}

function asObject(rows) {
  return Object.fromEntries(rows);
}

function asMap(rows) {
  return new Map(rows).size;
}

const uses = { sumOfRows, sumWithoutALocal, walkRows, firstCells, widths, flattened, flattenedByConcat, flattenedBySpread, padded, transposedFirst, sortedRows, asObject, asMap };

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  slice() {
    return ["the subclass's slice"];
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const rows = {
  "an array": () => [5, 6],
  "an array-like": () => ({ 0: 5, 1: 6, length: 2 }),
  "a subclass": () => Loud.of(5, 6),
  "a string": () => "56",
  "a typed array": () => new Uint8Array([5, 6]),
  "a Set": () => new Set([5, 6]),
  "arguments": () => (function () { return arguments; })(5, 6),
  "a proxy": () => new Proxy([5, 6], {}),
  "a frozen array": () => Object.freeze([5, 6]),
  "doubles": () => [5.5, 6.5],
  "an array with a hole": () => [5, , 6],
  "an empty array": () => [],
  "a number": () => 56,
  "null": () => null,
  "undefined": () => undefined,
  "a spreadable object": () => ({ 0: 5, 1: 6, length: 2, [Symbol.isConcatSpreadable]: true }),
  "an array that is not spreadable": () => Object.assign([5, 6], { [Symbol.isConcatSpreadable]: false }),
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([[1, 2], [3, 4], [5, 6]]);

for (const name in rows) for (const use in uses) attempt("the last row is " + name + ", " + use, () => uses[use]([[1, 2], [3, 4], rows[name]()]));
for (const use in uses) attempt("the last row is missing, " + use, () => uses[use]([[1, 2], [3, 4], ,]));
