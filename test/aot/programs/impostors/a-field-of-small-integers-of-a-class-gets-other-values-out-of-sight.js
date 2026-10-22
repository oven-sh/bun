function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "array(" + value.length + ")";
  if (typeof value === "object" && value !== null) return "object";
  return String(value);
}

function attempt(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

class Counter {
  constructor(start) {
    this.count = start;
    this.step = 1;
  }
}

const makers = {
  class: start => new Counter(start),
};

function readCount(counter) {
  return counter.count;
}

function addToCount(counter) {
  return counter.count + counter.step;
}

function maskCount(counter) {
  return counter.count | 0;
}

function kindOfCount(counter) {
  return typeof counter.count;
}

function sumCounts(counters) {
  let total = 0;
  for (let i = 0; i < counters.length; i++) total += counters[i].count;
  return total;
}

const name = JSON.parse('"count"');
const storeMadeAtRunTime = new Function("counter", "value", "counter.count = value;");

const writers = {
  "a computed name": (counter, value) => {
    counter[name] = value;
  },
  "Reflect.set": (counter, value) => {
    Reflect.set(counter, name, value);
  },
  "Object.assign": (counter, value) => {
    Object.assign(counter, { [name]: value });
  },
  "Object.defineProperty": (counter, value) => {
    Object.defineProperty(counter, name, { value });
  },
  "a function made at run time": (counter, value) => {
    storeMadeAtRunTime(counter, value);
  },
  "a destructuring assignment": (counter, value) => {
    [counter[name]] = [value];
  },
  "the head of a for-of loop": (counter, value) => {
    for (counter[name] of [value]);
  },
  "Object.entries and a loop": (counter, value) => {
    for (const [key, entry] of Object.entries({ [name]: value })) counter[key] = entry;
  },
};

const values = [
  1.5,
  -0,
  NaN,
  Infinity,
  2147483647,
  2147483648,
  -2147483648,
  -2147483647,
  -2147483646,
  -2147483645,
  -2147483644,
  -2147483643,
  -2147483649,
  4294967296,
  "7",
  "",
  true,
  null,
  undefined,
  10n,
  Symbol.iterator,
  [3],
  { valueOf: () => 9 },
  () => 1,
];

for (const [made, make] of Object.entries(makers)) {
  const honest = [];
  for (let i = 0; i < 2000; i++) honest.push(make(i & 1023));
  console.log(made, "honest sum", sumCounts(honest));
  let checks = 0;
  for (const counter of honest)
    checks += readCount(counter) + addToCount(counter) + maskCount(counter) + kindOfCount(counter).length;
  console.log(made, "honest checks", checks);

  for (const [way, write] of Object.entries(writers)) {
    for (const value of values) {
      const counter = make(5);
      const outcome = attempt(() => write(counter, value));
      console.log(
        made + ",",
        way + ",",
        show(value) + ":",
        outcome === "undefined" ? "stored" : outcome,
        "read",
        attempt(() => readCount(counter)),
        "added",
        attempt(() => addToCount(counter)),
        "masked",
        attempt(() => maskCount(counter)),
        "typeof",
        attempt(() => kindOfCount(counter)),
        "keys",
        Object.keys(counter).join(),
        "own",
        Object.hasOwn(counter, "count"),
      );
    }
  }

  const mixed = [make(1), make(2), make(3)];
  writers["a computed name"](mixed[1], 0.25);
  console.log(made, "a sum over three with a fraction in the middle", sumCounts(mixed));
  writers["a computed name"](mixed[1], "x");
  console.log(made, "a sum over three with a string in the middle", show(sumCounts(mixed)));
  writers["a computed name"](mixed[1], 4);
  console.log(made, "a sum over three honest ones again", sumCounts(mixed));
}
