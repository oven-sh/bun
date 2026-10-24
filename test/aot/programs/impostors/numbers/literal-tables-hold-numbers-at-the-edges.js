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

const ZEROS = [0, -0, 0, -0];
const ONLY_NEGATIVE_ZERO = [-0];
const LIMITS = [2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296];
const SMALLEST = [-2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643];
const SPECIAL = [NaN, Infinity, -Infinity, 1e400, -1e400, 5e-324, 1.7976931348623157e308];
const FRACTIONS = [0.5, 1.5, 0.1, 1e21, 1e-7, 9007199254740993];
const INTEGERS_AND_A_FRACTION = [1, 2, 3, 4.5];
const INTEGERS_AND_A_HOLE = [1, , 3];
const INTEGERS_AND_UNDEFINED = [1, undefined, 3];
const INTEGERS_AND_NULL = [1, null, 3];
const INTEGERS_AND_A_TEXT = [1, "2", 3];
const INTEGERS_AND_A_BIGINT = [1, 2n, 3];
const FRACTIONS_AND_A_HOLE = [0.5, , 1.5];
const NESTED = [[0, -0], [1, 2.5], [[-0]]];
const RECORD = { zero: 0, negativeZero: -0, nan: NaN, largest: 2147483647, above: 2147483648, smallest: -2147483648, reserved: -2147483647, alsoReserved: -2147483646, third: -2147483645, fraction: 0.5, huge: 1e21 };
const RECORDS = [
  { n: 1, m: 0 },
  { n: -0, m: -2147483647 },
  { n: 2.5, m: -2147483646 },
  { n: NaN, m: -2147483645 },
  { n: 2147483648, m: undefined },
  { n: "6", m: null },
];
const FROZEN = Object.freeze([0, -0, NaN]);

function fresh() {
  return {
    zeros: [0, -0],
    limits: [2147483647, 2147483648, -2147483648, -2147483649],
    smallest: [-2147483648, -2147483647, -2147483646, -2147483645],
    record: { zero: 0, negativeZero: -0, nan: NaN, reserved: -2147483647, alsoReserved: -2147483646, third: -2147483645 },
    hole: [1, , -0],
  };
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function signs(list) {
  const result = [];
  for (let i = 0; i < list.length; i++) result.push(1 / list[i]);
  return result;
}

function column(records, name) {
  const result = [];
  for (let i = 0; i < records.length; i++) result.push(records[i][name]);
  return result;
}

const tables = { ZEROS, ONLY_NEGATIVE_ZERO, LIMITS, SMALLEST, SPECIAL, FRACTIONS, INTEGERS_AND_A_FRACTION, INTEGERS_AND_A_HOLE, INTEGERS_AND_UNDEFINED, INTEGERS_AND_NULL, INTEGERS_AND_A_TEXT, INTEGERS_AND_A_BIGINT, FRACTIONS_AND_A_HOLE, FROZEN };
for (const round of ["first", "second"]) {
  for (const name of Object.keys(tables)) {
    attempt(round + " " + name, () => tables[name]);
    attempt(round + " sum of " + name, () => sum(tables[name]));
    attempt(round + " JSON of " + name, () => JSON.stringify(tables[name]));
  }
  attempt(round + " signs of ZEROS", () => signs(ZEROS));
  attempt(round + " signs of ONLY_NEGATIVE_ZERO", () => signs(ONLY_NEGATIVE_ZERO));
  attempt(round + " NESTED", () => NESTED);
  attempt(round + " RECORD", () => RECORD);
  attempt(round + " RECORD members", () => [RECORD.negativeZero, 1 / RECORD.negativeZero, RECORD.nan, RECORD.reserved, RECORD.alsoReserved, RECORD.third, RECORD.smallest, RECORD.above]);
  attempt(round + " RECORD keys", () => Object.keys(RECORD));
  attempt(round + " column n", () => column(RECORDS, "n"));
  attempt(round + " column m", () => column(RECORDS, "m"));
  attempt(round + " members n and m", () => RECORDS.map(record => [record.n, record.m, typeof record.m, "m" in record]));
  attempt(round + " fresh", () => fresh());
  attempt(round + " fresh members", () => {
    const made = fresh();
    return [made.zeros[1], 1 / made.zeros[1], made.record.negativeZero, made.record.reserved, made.record.alsoReserved, made.record.third, 1 in made.hole, made.hole[2]];
  });
  attempt(round + " includes and indexOf", () => [ZEROS.includes(-0), ZEROS.indexOf(-0), SPECIAL.includes(NaN), SPECIAL.indexOf(NaN), INTEGERS_AND_A_HOLE.includes(undefined), INTEGERS_AND_A_HOLE.indexOf(undefined)]);
  attempt(round + " copies", () => [[...ZEROS], ZEROS.slice(), ZEROS.concat(ONLY_NEGATIVE_ZERO), Array.from(ZEROS), ZEROS.map(x => x), structuredClone(ZEROS)]);
  for (let i = 0; i < 500; i++) {
    sum(ZEROS);
    sum(LIMITS);
    signs(ZEROS);
    column(RECORDS, "n");
    fresh();
  }
}
