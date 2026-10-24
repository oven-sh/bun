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

function subtract(a, b) {
  return a - b;
}

function double(value) {
  return value * 2;
}

function truncate(value) {
  return value | 0;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += add(i, 1) + scale(i, 2) + bucket(i) + next(i) + clamp(i, 0, 10) + subtract(i, 1) + double(i) + truncate(i);
console.log("the honest total", total);

const mixed = () => JSON.parse('[1, "2", 2.5, null, true, [3], {}, -0, 2147483648, "x"]');
const texts = () => JSON.parse('["7", "8", "9"]');

attempt("map next", () => mixed().map(next));
attempt("map double", () => mixed().map(double));
attempt("map truncate", () => mixed().map(truncate));
attempt("map bucket", () => mixed().map(bucket));
attempt("map add takes the index", () => mixed().map(add));
attempt("map subtract takes the index", () => mixed().map(subtract));
attempt("map scale takes the index", () => mixed().map(scale));
attempt("map clamp takes the index and the list", () => texts().map(clamp));
attempt("reduce add", () => mixed().reduce(add));
attempt("reduce subtract", () => mixed().reduce(subtract));
attempt("reduce scale", () => texts().reduce(scale));
attempt("reduceRight add", () => texts().reduceRight(add));
attempt("Array.from next", () => Array.from(texts(), next));
attempt("Array.from a text double", () => Array.from("123", double));
attempt("sort subtract", () => texts().reverse().sort(subtract));
attempt("sort subtract on mixed values", () => JSON.parse('[10, "9", true, null, [2]]').sort(subtract));
attempt("toSorted subtract", () => texts().reverse().toSorted(subtract));
attempt("filter truncate", () => mixed().filter(truncate));
attempt("find bucket", () => mixed().find(bucket));
attempt("findIndex truncate", () => JSON.parse('["0", 0.5, "x", "3"]').findIndex(truncate));
attempt("some and every double", () => [mixed().some(double), mixed().every(double)]);
attempt("flatMap next", () => texts().flatMap(next));
attempt("typed map double", () => Array.from(new Uint8Array([100, 200]).map(double)));
attempt("typed reduce add", () => new Float32Array([0.5, 1.5]).reduce(add));
attempt("replace next", () => "a1b22".replace(/\d+/g, next));
attempt("replace add takes the offset", () => "a1b22".replace(/\d+/g, add));
attempt("replaceAll double", () => "1-2".replaceAll(/\d/g, double));
attempt("Reflect.apply", () => [Reflect.apply(next, null, texts()), Reflect.apply(add, null, texts()), Reflect.apply(bucket, null, mixed().slice(2))]);
attempt("apply with a parsed list", () => [next.apply(null, texts()), add.apply(null, texts()), clamp.apply(null, texts())]);
attempt("spread of a parsed list", () => [next(...texts()), add(...texts()), clamp(...texts())]);
attempt("as valueOf", () => ({ valueOf: next }) + 1);
attempt("as toJSON", () => JSON.stringify({ n: { toJSON: next } }));
attempt("as a reviver", () => JSON.parse('{"a": 1, "b": "2"}', add));
attempt("as a replacer", () => JSON.stringify({ a: 1, b: "2" }, add));
attempt("as a getter", () => Object.defineProperty({}, "n", { get: next }).n);
attempt("as a proxy trap", () => new Proxy({}, { get: add }).name.length > 0);
attempt("as Symbol.toPrimitive", () => `${{ [Symbol.toPrimitive]: next }}`);
attempt("Map forEach add", () => {
  const seen = [];
  const collect = { push: add };
  new Map(JSON.parse('[["1", 1], [2, "2"]]')).forEach((value, key) => seen.push(collect.push(value, key)));
  return seen;
});

Promise.resolve(texts()[0])
  .then(next)
  .then(value => {
    console.log("a promise reaction next ->", show(value));
    return texts()[1];
  })
  .then(double)
  .then(value => {
    console.log("a promise reaction double ->", show(value));
    let again = 0;
    for (let i = 0; i < 2000; i++) again += add(i, 1) + scale(i, 2) + bucket(i) + next(i) + clamp(i, 0, 10) + subtract(i, 1) + double(i) + truncate(i);
    console.log("the honest total again", again);
  });
