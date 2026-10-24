const log = [];

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

class Meter {
  constructor(count) {
    this.count = count;
    this.limit = 100;
  }
  plusOne() {
    return this.count + 1;
  }
  times(factor) {
    return this.count * factor;
  }
  asInt() {
    return this.count | 0;
  }
  shifted() {
    return this.count >>> 1;
  }
  negated() {
    return -this.count;
  }
  tick() {
    this.count++;
    return this.count;
  }
  addTo(amount) {
    this.count += amount;
    return this.count;
  }
  belowLimit() {
    return this.count < this.limit;
  }
  isFive() {
    return this.count === 5;
  }
  looselyFive() {
    return this.count == 5;
  }
  index(list) {
    return list[this.count];
  }
  text() {
    return "count " + this.count;
  }
  truthy() {
    return this.count ? "yes" : "no";
  }
  kind() {
    return typeof this.count;
  }
  remainder() {
    return this.count % 3;
  }
  rounded() {
    return Math.floor(this.count);
  }
}

const methods = [
  ["plusOne", meter => meter.plusOne()],
  ["times 2", meter => meter.times(2)],
  ["| 0", meter => meter.asInt()],
  [">>> 1", meter => meter.shifted()],
  ["negated", meter => meter.negated()],
  ["++", meter => meter.tick()],
  ["+= 1", meter => meter.addTo(1)],
  ["< limit", meter => meter.belowLimit()],
  ["=== 5", meter => meter.isFive()],
  ["== 5", meter => meter.looselyFive()],
  ["as an index", meter => meter.index(["zero", "one", "two", "three", "four", "five"])],
  ["in a string", meter => meter.text()],
  ["as a condition", meter => meter.truthy()],
  ["typeof", meter => meter.kind()],
  ["% 3", meter => meter.remainder()],
  ["Math.floor", meter => meter.rounded()],
];

const values = [
  "5",
  "'5'",
  "5.5",
  "-0",
  "NaN",
  "2147483647",
  "2147483648",
  "9007199254740993",
  "5n",
  "true",
  "null",
  "undefined",
  "({})",
  "({ valueOf() { log.push('valueOf'); return 5; } })",
  "({ [Symbol.toPrimitive](hint) { log.push('toPrimitive ' + hint); return 5; } })",
  "({ toString() { log.push('toString'); return '5'; } })",
  "new Number(5)",
  "new Date(5)",
  "Symbol.for('five')",
];

const stores = [
  ["a store", new Function("meter", "value", "meter.count = value;")],
  ["a store under a computed name", new Function("meter", "value", "meter['co' + 'unt'] = value;")],
  ["Object.assign", new Function("meter", "value", "Object.assign(meter, { count: value });")],
  ["defineProperty", new Function("meter", "value", "Object.defineProperty(meter, 'count', { value });")],
  ["Reflect.set", new Function("meter", "value", "Reflect.set(meter, 'count', value);")],
];

let sum = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, method] of methods) {
    const result = method(new Meter(i % 6));
    if (typeof result === "number") sum += result;
  }
}
console.log("2000 honest rounds", sum);

values.forEach((text, position) => {
  const [way, store] = stores[position % stores.length];
  for (const [name, method] of methods) {
    const meter = new Meter(1);
    store(meter, new Function("log", "return " + text + ";")(log));
    let line = text + " by " + way + " | " + name + " -> ";
    try {
      line += show(method(meter));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line + " | count is now " + show(meter.count) + (log.length ? " | log " + log.splice(0).join(", ") : ""));
  }
});

console.log("honest again", methods.map(([, method]) => show(method(new Meter(5)))).join(" "));
