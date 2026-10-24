// Objects inside objects: repo binds impostors numbers honest plain callers and impostors through call apply and bind. It prints what plain Bun prints.
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

function add(a, b) {
  return a + b;
}

function scale(value, factor) {
  return value * factor;
}

function bucket(value) {
  return value & 15;
}

function next(value) {
  return value + 1;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function average(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total / list.length;
}

function power(base, exponent) {
  if (exponent === 0) return 1;
  return base * power(base, exponent - 1);
}

function digits(value) {
  let count = 0;
  try {
    do {
      count++;
      value = (value / 10) | 0;
    } while (value > 0);
  } finally {
    count += 0;
  }
  return count;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += add(i, 1) + scale(i, 2) + bucket(i) + next(i) + clamp(i, 0, 10) + average([i, i]) + power(2, i & 7) + digits(i);
console.log("the honest total", total);

attempt("add.call(null, '1', 2)", () => add.call(null, "1", 2));
attempt("add.apply(null, ['1', 2])", () => add.apply(null, ["1", 2]));
attempt("add.bind(null, '1')(2)", () => add.bind(null, "1")(2));
attempt("add.bind(null, 1)('2')", () => add.bind(null, 1)("2"));
attempt("add.apply(null, an array-like)", () => add.apply(null, { length: 2, 0: 1.5, 1: "x" }));
attempt("add.apply(null, [])", () => add.apply(null, []));
attempt("Reflect.apply(add, null, [1n, 2n])", () => Reflect.apply(add, null, [1n, 2n]));
attempt("Function.prototype.call.call(add, null, '1', 2)", () => Function.prototype.call.call(add, null, "1", 2));
attempt("add(...['1', 2])", () => add(...["1", 2]));
attempt("add(...'12')", () => add(..."12"));
attempt("scale.call(null, '3', '4')", () => scale.call(null, "3", "4"));
attempt("scale.apply(null, [0, -1])", () => scale.apply(null, [0, -1]));
attempt("scale.bind(null, 65536)(65536)", () => scale.bind(null, 65536)(65536));
attempt("bucket.call(null, '300')", () => bucket.call(null, "300"));
attempt("bucket.apply(null, [4294967297])", () => bucket.apply(null, [4294967297]));
attempt("bucket.bind(null, 300n)()", () => bucket.bind(null, 300n)());
attempt("next.call(null, '41')", () => next.call(null, "41"));
attempt("next.apply(null, [2147483647])", () => next.apply(null, [2147483647]));
attempt("next.bind(null)()", () => next.bind(null)());
attempt("clamp.call(null, '5', 0, 3)", () => clamp.call(null, "5", 0, 3));
attempt("clamp.apply(null, [NaN, 0, 3])", () => clamp.apply(null, [NaN, 0, 3]));
attempt("average.call(null, '12')", () => average.call(null, "12"));
attempt("power.call(null, '3', 2)", () => power.call(null, "3", 2));
attempt("digits.apply(null, ['12345'])", () => digits.apply(null, ["12345"]));

const byName = { add, scale, bucket, next, clamp, average, power, digits };
const names = Object.keys(byName);
attempt("methods read by computed names", () => names.map(name => outcome(() => byName[name]("7", "2", "9"))));
attempt("methods read by computed names, honest", () => names.map(name => outcome(() => byName[name](7, 2, 9))));
attempt("as callbacks", () => ["7", 7, 7.5].map(next).concat(["7", 7, 7.5].map(bucket)));
attempt("as a reducer", () => ["7", 7, 7.5].reduce(add));
attempt("as a sort comparator", () => [3, 1, 2].sort(scale));
attempt("as a getter", () => Object.defineProperty({}, "n", { get: next }).n);
attempt("as a setter", () => {
  const seen = [];
  const holder = Object.defineProperty({}, "n", { set: value => seen.push(next(value)) });
  holder.n = "1";
  holder.n = 1;
  return seen;
});
attempt("as valueOf", () => ({ valueOf: next }) * 2);
attempt("as a constructor", () => typeof new next("1"));
attempt("as a tag", () => next`text`);

attempt("honest plain calls afterwards", () => [add(1, 2), scale(3, 4), bucket(300), next(41), clamp(5, 0, 3), average([1, 2, 3]), power(3, 4), digits(12345)]);
