// Objects inside objects: repo binds impostors numbers native callbacks hand over values that are not numbers. It prints what plain Bun prints.
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

function double(value) {
  return value * 2;
}

function addOne(value) {
  return value + 1;
}

function truncate(value) {
  return value | 0;
}

function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function indexTimesTwo(value, index) {
  return index * 2;
}

for (let i = 0; i < 2000; i++) {
  double(i);
  addOne(i);
  truncate(i);
  add(i, 1);
  subtract(i, 1);
  indexTimesTwo(i, i);
}

const mixed = () => [1, "2", 2.5, null, undefined, true, [3], { valueOf: () => 4 }, -0, NaN, 2147483648];
attempt("map double", () => mixed().map(double));
attempt("map addOne", () => mixed().map(addOne));
attempt("map truncate", () => mixed().map(truncate));
attempt("map add takes the index", () => mixed().map(add));
attempt("map subtract takes the index", () => mixed().map(subtract));
attempt("map indexTimesTwo", () => mixed().map(indexTimesTwo));
attempt("reduce add", () => mixed().reduce(add));
attempt("reduce add from zero", () => mixed().reduce(add, 0));
attempt("reduce subtract", () => mixed().reduce(subtract));
attempt("reduceRight add", () => mixed().reduceRight(add));
attempt("reduce add of integers", () => [1, 2, 3].reduce(add));
attempt("reduce add of bigints", () => [1n, 2n, 3n].reduce(add));
attempt("reduce add of bigints from zero", () => [1n, 2n, 3n].reduce(add, 0));
attempt("map double over holes", () => [1, , 3].map(double));
attempt("Array.from double", () => Array.from({ length: 3, 0: "1", 2: 3 }, double));
attempt("Array.from a text", () => Array.from("123", double));
attempt("Array.from a text addOne", () => Array.from("123", addOne));
attempt("typed map double", () => Array.from(new Uint8Array([100, 200]).map(double)));
attempt("typed map to fractions", () => Array.from(new Int32Array([1, 3]).map(value => value / 2)));
attempt("Set forEach", () => {
  const seen = [];
  new Set([1, "2"]).forEach((value, again) => seen.push(add(value, again)));
  return seen;
});
attempt("Map forEach", () => {
  const seen = [];
  new Map([["1", 1], [2, "2"]]).forEach((value, key) => seen.push(add(value, key), subtract(value, key)));
  return seen;
});
attempt("replace hands over texts and an offset", () => "a1b22".replace(/\d+/g, (match, offset) => "<" + double(match) + "," + addOne(match) + "," + addOne(offset) + ">"));
attempt("replace with a group", () => "7-8".replace(/(\d)-(\d)/, (match, a, b) => add(a, b) + "," + subtract(a, b)));
attempt("Reflect.apply", () => [Reflect.apply(double, null, ["4"]), Reflect.apply(add, null, ["4", 1]), Reflect.apply(add, null, [4])]);
attempt("call and apply", () => [double.call(null, "4"), add.apply(null, ["4", 1]), add.call(null, 4), truncate.apply(null, [[5]])]);
attempt("bind", () => [add.bind(null, "4")(1), add.bind(null, 4)("1"), subtract.bind(null, "4")(1), double.bind(null)()]);
attempt("flatMap", () => [1, "2"].flatMap(value => [double(value), addOne(value)]));
attempt("find by arithmetic", () => ["1", 2, "3"].find(value => addOne(value) === 3));
attempt("findIndex by arithmetic", () => ["1", 2, "3"].findIndex(value => addOne(value) === "31"));
attempt("filter by arithmetic", () => mixed().filter(value => truncate(value) === value));
attempt("every and some", () => [mixed().every(value => double(value) === double(value)), mixed().some(value => double(value) !== double(value))]);
attempt("toString on the way to a key", () => ({ 2: "two", 21: "twenty-one" })[addOne("2")]);
attempt("JSON.stringify replacer", () => JSON.stringify({ a: 1, b: "2", c: null }, (key, value) => (key ? addOne(value) : value)));
attempt("a getter called by Object.assign", () => Object.assign({}, { get n() { return addOne("1"); } }));
attempt("honest calls afterwards", () => [double(4), addOne(4), truncate(4), add(4, 1), subtract(4, 1)]);

Promise.resolve("5")
  .then(double)
  .then(value => {
    console.log("a promise reaction double ->", show(value));
    return "5";
  })
  .then(addOne)
  .then(value => {
    console.log("a promise reaction addOne ->", show(value));
    return Promise.all([1, "2", Promise.resolve(3n)]);
  })
  .then(values => {
    console.log("Promise.all ->", outcome(() => values.map(addOne)));
    console.log("Promise.all reduce ->", outcome(() => values.reduce(add)));
  });
